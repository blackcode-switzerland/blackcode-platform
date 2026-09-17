// G2 in the database and `DOCUMENT_FIELDS` in the app name the same columns.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// Until 2026-09-17 `DOCUMENT_FIELDS` carried the comment "Mirrors 0005's
// trigger", and it did not: the app froze `vat_rate` and the trigger did not,
// and NEITHER froze `language`. A mirror nobody compared is a claim about
// protection (CLAUDE.md finding #18). Migration 0007 reconciled them; this keeps
// them reconciled.
//
// It reads the NEWEST migration that defines `billing.invoice_document_frozen`,
// not a fixed file, because the next change to G2 will be another
// `CREATE OR REPLACE` in a later migration — and a test pinned to 0007 would
// keep reading the old list and passing.
//
// The trigger's list is a superset: it also freezes the three delivery columns,
// which the app refuses on EVERY invoice (`NEVER_EDITABLE`), draft or not.
//
// Watched failing on 2026-09-17, each restored:
//   - `'language'` removed from DOCUMENT_FIELDS → "the app does not freeze language"
//   - the `language` WHEN line removed from 0007 → "the trigger does not freeze language"
//   - 0007's definition hidden, so 0005's is the newest → three cases red: the
//     "newest definition" input check, "app freezes ⊆ trigger" (vat_rate,
//     language) and the delivery evidence

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOCUMENT_FIELDS } from './invoices'

const MIGRATIONS = join(__dirname, '..', 'migrations')
const DELIVERY_COLUMNS = ['sent_at', 'sent_message_id', 'pdf_sha256']

function triggerFrozenColumns(): { file: string; columns: string[] } {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  let found: { file: string; columns: string[] } | null = null
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
    const m = /CREATE OR REPLACE FUNCTION billing\.invoice_document_frozen\(\)[\s\S]*?END \$\$;/.exec(sql)
    if (!m) continue
    // Strip SQL comments so a column named in prose is not read as frozen.
    const body = m[0].replace(/--.*$/gm, '')
    // `[a-z0-9_]` after the first character: the first draft read `[a-z_]+`,
    // which cannot match `pdf_sha256` — so a frozen column with a digit in its
    // name was invisible to both directions of this test. The delivery-evidence
    // case below is what caught it, on its first run.
    const columns = [...body.matchAll(/WHEN NEW\.([a-z_][a-z0-9_]*)\s+IS DISTINCT FROM OLD\.\1\b/g)].map((x) => x[1])
    found = { file, columns }
  }
  if (!found) throw new Error('no migration defines billing.invoice_document_frozen()')
  return found
}

describe('G2 frozen columns', () => {
  const { file, columns } = triggerFrozenColumns()

  it('reads a non-empty list from the newest definition', () => {
    // Assert the input: an extraction that found nothing would make both
    // directions below vacuously true.
    expect(columns.length).toBeGreaterThan(5)
    expect(file >= '0007').toBe(true)
  })

  it('every column the app freezes, the trigger freezes', () => {
    for (const f of DOCUMENT_FIELDS) {
      expect(columns, `the trigger (${file}) does not freeze ${f}`).toContain(f)
    }
  })

  it('every editable column the trigger freezes, the app freezes', () => {
    for (const c of columns.filter((c) => !DELIVERY_COLUMNS.includes(c))) {
      expect([...DOCUMENT_FIELDS], `the app does not freeze ${c}`).toContain(c)
    }
  })

  it('the trigger freezes the delivery evidence', () => {
    for (const c of DELIVERY_COLUMNS) expect(columns).toContain(c)
  })
})

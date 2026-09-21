// The issuer copy (invariant I12): one key list, held to the migration that
// enforces it, and no render path that reaches around it.
//
// The behaviour — a company edit never moves a sent bill — is asserted against
// a real database in `lib/invariants.test.ts`, I12. This file holds the parts a
// database cannot see: that three hand-written lists name the same keys, and
// that nothing which renders a document reads `billing.company` for itself.
//
// ===========================================================================
// WATCHED FAILING, 2026-09-18 — each restored
// ===========================================================================
//   - `'rounding'` removed from ISSUER_FIELDS          → backfill, shape and "copies the listed fields" red
//   - `'footer_en'` removed from 0011's shape CHECK    → shape case red
//   - `import { billingCompany } from '@/lib/db/schema'` added to lib/pdf/invoice.ts
//                                                      → "and none of them does" red
//   - the same line added inside a `//` comment        → green, correctly (comments are stripped)
//   - `SCANNED` pointed at `lib/email`                 → "found files to scan" red

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { billingCompany } from '@/lib/db/schema'
import { ISSUER_FIELDS, issuerOf, issuerSnapshot, type IssuerRow } from './issuer'

const ROOT = join(__dirname, '..')
const MIGRATION = readFileSync(join(ROOT, 'lib/db/migrations/0011_billing_issuer_snapshot.sql'), 'utf8')

/** The quoted keys in the statement that follows a marker comment, up to its terminating `;`. */
function keysAfter(marker: string): string[] {
  const at = MIGRATION.indexOf(marker)
  if (at < 0) throw new Error(`marker ${marker} not found in migration 0011`)
  const statement = MIGRATION.slice(at, MIGRATION.indexOf(';--> statement-breakpoint', at)).replace(/--.*$/gm, '')
  return [...statement.matchAll(/'([a-z_]+)'\s*(?=,|\])/g)].map((m) => m[1])
}

const company: IssuerRow & Record<string, unknown> = {
  id: 9, next_seq: 41, slug: 'acme', workspace_id: 3,
  name: 'Acme', legal_name: 'Acme SA', street: 'Rue', building: '1', postal_code: '1200', city: 'Genève', country: 'CH',
  email: 'a@acme.ch', logo_initials: 'AC', logo_color: '#112233', iban: 'CH9300762011623852957', qr_iban: null,
  vat_registered: true, uid: 'CHE-1', vat_number: 'CHE-1 TVA', rounding: 'line_0_05', footer_fr: 'fr', footer_en: null,
}

describe('ISSUER_FIELDS', () => {
  it('are all columns of billing.company', () => {
    const columns = getTableConfig(billingCompany).columns.map((c) => c.name)
    expect(columns.length).toBeGreaterThan(20)
    for (const k of ISSUER_FIELDS) expect(columns, `billing.company has no column ${k}`).toContain(k)
  })

  it('are exactly what migration 0011 backfills', () => {
    const keys = keysAfter('ISSUER-BACKFILL').filter((k) => !['captured_at', 'backfilled'].includes(k))
    expect(keys.length).toBeGreaterThan(10)
    expect([...keys].sort()).toEqual([...ISSUER_FIELDS].sort())
  })

  it('are exactly what migration 0011’s shape CHECK requires, plus captured_at', () => {
    const keys = keysAfter('ISSUER-SHAPE')
    expect(keys.length).toBeGreaterThan(10)
    expect([...keys].sort()).toEqual([...ISSUER_FIELDS, 'captured_at'].sort())
  })
})

describe('issuerSnapshot / issuerOf', () => {
  it('copies the listed fields and nothing else — no id, no allocator', () => {
    const snap = issuerSnapshot(company, new Date('2026-09-18T10:00:00.000Z'))
    expect(Object.keys(snap).sort()).toEqual([...ISSUER_FIELDS, 'captured_at'].sort())
    expect(snap.captured_at).toBe('2026-09-18T10:00:00.000Z')
    expect(snap.qr_iban).toBeNull()
    expect(snap.legal_name).toBe('Acme SA')
  })

  it('a stored copy always wins over the live company', () => {
    const snap = issuerSnapshot(company)
    const live = { ...snap, iban: 'CH5604835012345678009', legal_name: 'Renamed SA' }
    expect(issuerOf(snap, live).iban).toBe('CH9300762011623852957')
    expect(issuerOf(null, live).iban).toBe('CH5604835012345678009')
    // The live branch carries no `captured_at`: "as it would be issued today".
    expect('captured_at' in issuerOf(null, live)).toBe(false)
  })
})

describe('nothing that renders a document reads billing.company for itself', () => {
  // The render and derivation paths. Each takes its issuer as an ARGUMENT,
  // resolved by `getInvoiceDocumentSource`; a direct read would be right for
  // every draft and wrong for exactly the invoices I12 is about.
  const SCANNED = ['lib/pdf', 'lib/delivery', 'lib/qr', 'app/api/workspaces/[ws]/invoices/[ref]/pdf', 'app/api/workspaces/[ws]/invoices/[ref]/qr']
  const REACH = /billingCompany|queries\/companies|getCompany\b|listCompanies\b/

  const walk = (dir: string): string[] =>
    readdirSync(join(ROOT, dir)).flatMap((f) => {
      const rel = join(dir, f)
      if (statSync(join(ROOT, rel)).isDirectory()) return walk(rel)
      return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [rel] : []
    })
  const files = SCANNED.flatMap((dir) => walk(dir))

  it('found files to scan', () => {
    expect(files.length).toBeGreaterThan(12)
    expect(files).toContain('lib/pdf/invoice.ts')
    expect(files).toContain('lib/delivery/document.ts')
  })

  it('and none of them does', () => {
    const offenders = files.filter((f) => {
      const code = readFileSync(join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      return REACH.test(code)
    })
    expect(offenders).toEqual([])
  })
})

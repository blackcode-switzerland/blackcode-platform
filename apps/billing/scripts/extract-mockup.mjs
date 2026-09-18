// Extract the b/billing mockup's data file into fixtures/mockup.json.
//
//   node scripts/extract-mockup.mjs ~/Developer/b-mockups/bbilling/assets/billing-data.js
//
// ── MECHANICAL, AND THAT IS THE POINT ──────────────────────────────────────
// The mockup is the specification (docs/billing-app-plan/README.md), and its
// `billing-data.js` is the reference implementation. This runs that file in a
// sandbox and writes out two things:
//
//   1. its DATA — workspaces, companies, invoices, recurrences, audit, history —
//      exactly as declared, for the seed;
//   2. its ANSWERS — what the mockup's own `computeTotals`, `invoiceReference`,
//      `fmtRef`, `fmtIBAN` and `invoiceAccount` return for every invoice — for
//      `lib/derive/parity.test.ts` to hold this app's derivations against.
//
// Nothing here is typed by hand. A parity test against numbers somebody copied
// out of a screenshot proves the copy; one against the mockup's own functions
// proves the app. The source file's sha256 and the mockup repo's commit are
// recorded, so "matches the mockup" names WHICH mockup.
//
// Re-run it when the mockup changes, and read the diff: a changed answer is a
// changed specification.

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const src = process.argv[2]
if (!src) {
  console.error('usage: node scripts/extract-mockup.mjs <path to bbilling/assets/billing-data.js>')
  process.exit(2)
}
const code = readFileSync(src, 'utf8')

const store = new Map()
const window = { location: { search: '' } }
const sandbox = {
  window,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  URLSearchParams,
}
vm.createContext(sandbox)
vm.runInContext(code, sandbox, { filename: src })
const D = window.PT_DATA
if (!D || !Array.isArray(D.INVOICES)) {
  console.error('the file did not define window.PT_DATA.INVOICES — has the mockup changed shape?')
  process.exit(1)
}

// Derived answers, per workspace: the mockup's lookups are scoped to the
// ACTIVE workspace, so each invoice is asked with its own workspace active.
const answers = {}
for (const ws of D.WORKSPACES) {
  D.setActiveWorkspaceSlug(ws.slug)
  for (const inv of D.INVOICES.filter((i) => i.workspace_id === ws.id)) {
    const t = D.computeTotals(inv)
    const account = D.invoiceAccount(inv)
    answers[inv.id] = {
      subtotal: D.fmtAmount(t.subtotal),
      has_vat: t.hasVat,
      vat: D.fmtAmount(t.vat),
      total: D.fmtAmount(t.total),
      reference: D.invoiceReference(inv),
      reference_formatted: D.fmtRef(inv),
      account,
      account_formatted: D.fmtIBAN(account),
    }
  }
}

let mockupCommit = null
try {
  mockupCommit = execFileSync('git', ['-C', dirname(resolve(src)), 'log', '-1', '--format=%H', '--', resolve(src)], {
    encoding: 'utf8',
  }).trim()
} catch {
  // Not a git checkout. The file hash below still pins the content.
}

const out = {
  source: {
    file: 'b-mockups/bbilling/assets/billing-data.js',
    sha256: createHash('sha256').update(code).digest('hex'),
    commit: mockupCommit,
    extracted_by: 'apps/billing/scripts/extract-mockup.mjs',
    note: 'Mechanical. Do not edit by hand — re-run the script and read the diff.',
  },
  workspaces: D.WORKSPACES,
  companies: D.COMPANIES,
  invoices: D.INVOICES,
  recurrences: D.RECURRENCES,
  audit: D.AUDIT,
  history: D.HISTORY,
  vat_rates: D.VAT_RATES,
  answers,
}

const here = dirname(fileURLToPath(import.meta.url))
const dest = join(here, '..', 'fixtures', 'mockup.json')
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n')
console.log(
  `wrote ${dest}: ${out.companies.length} companies, ${out.invoices.length} invoices, ` +
    `${out.recurrences.length} recurrences, ${out.audit.length} audit rows, ${out.history.length} history rows ` +
    `(mockup ${mockupCommit?.slice(0, 7) ?? 'not in git'}, sha256 ${out.source.sha256.slice(0, 12)})`
)

// The three copies of every closed vocabulary agree.
//
// ===========================================================================
// WHY THERE ARE THREE, AND WHY THAT NEEDS A GUARD
// ===========================================================================
// A closed set of values in this app exists in three places, and each one is
// load-bearing:
//
//   1. **`lib/vocabularies.ts`** — the served list, with its labels, colours and
//      consequences. `/api/meta` sends it, so a surface renders a new value
//      without a release.
//   2. **`types/index.ts`** — a TypeScript union, so a route handler assigning
//      an impossible status is a compile error rather than a 500.
//   3. **the CHECK constraint in migration 0005** — so the DATABASE refuses a
//      bad value, against a migration, a console session, or a second
//      deployment. The app is not the only thing that can write here.
//
// None of the three is removable. The union cannot be derived from the served
// list in a way `tsc` narrows usefully across a JSON boundary, and neither can
// enforce anything inside Postgres.
//
// **So they are checked against each other.** This is CLAUDE.md finding #18's
// lesson: a comment once claimed a test asserted that a scanner matched a
// migration's triggers, and no such test had ever been written. A citation is a
// claim about what this repo protects, and phase 1's plan says explicitly that
// "a test asserts they agree" — so here it is, rather than the claim.
//
// ── WHAT IT DELIBERATELY DOES NOT CHECK ────────────────────────────────────
// Labels, colours and notes. Those are copy, they live in one place, and there
// is nothing to disagree with. It checks the VALUES, which are the part three
// files each have an opinion about.
//
// It also cannot see a value the migration permits through a shape rather than a
// list — `invoice_currency_shape_check` is `~ '^[A-Z]{3}$'`, and currency is
// deliberately not a closed vocabulary. Those are absent from the map below,
// with that reason.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACTOR_VIA,
  AUDIT_ACTIONS,
  DOCUMENT_LANGUAGES,
  HISTORY_SOURCES,
  HISTORY_STATUSES,
  INVITATION_STATUSES,
  INVOICE_STATUSES,
  MEMBER_ROLES,
  REFERENCE_TYPES,
  ROUNDING_POLICIES,
  type Term,
} from './vocabularies'

const LIB = fileURLToPath(new URL('.', import.meta.url))
const TYPES = readFileSync(join(LIB, '..', 'types', 'index.ts'), 'utf8')

/**
 * Every migration in `lib/db/migrations/`, concatenated.
 *
 * Read as a directory rather than by naming 0005, because a constraint moved or
 * replaced by a later migration would otherwise make this guard read a file that
 * no longer describes the database. Reading them all means the check is against
 * everything that has been applied.
 */
const MIGRATIONS = (() => {
  const dir = join(LIB, 'db', 'migrations')
  const { readdirSync } = require('node:fs') as typeof import('node:fs')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
})()

/**
 * One vocabulary and where its other two copies live.
 *
 * `typeName` is the union in `types/index.ts`. `constraint` is the CHECK's name
 * in a migration — named rather than searched for, because a search for the
 * VALUES would find them in the prose of a comment and pass on that.
 */
interface Triple {
  terms: Term[]
  typeName: string
  constraint: string
  /**
   * Further CHECKs that enforce the SAME list on another column. A vocabulary
   * reused by a later table is a fourth copy, and without this line nothing
   * would notice that copy drifting — `history_imported_via_check` (0010)
   * restates `audit_via_check`'s two values.
   */
  alsoConstraints?: string[]
}

const TRIPLES: Record<string, Triple> = {
  INVOICE_STATUSES: {
    terms: INVOICE_STATUSES,
    typeName: 'InvoiceStatus',
    constraint: 'invoice_status_check',
  },
  REFERENCE_TYPES: {
    terms: REFERENCE_TYPES,
    typeName: 'ReferenceType',
    constraint: 'invoice_ref_type_check',
  },
  DOCUMENT_LANGUAGES: {
    terms: DOCUMENT_LANGUAGES,
    typeName: 'DocumentLanguage',
    constraint: 'invoice_language_check',
  },
  ROUNDING_POLICIES: {
    terms: ROUNDING_POLICIES,
    typeName: 'RoundingPolicy',
    constraint: 'company_rounding_check',
  },
  AUDIT_ACTIONS: {
    terms: AUDIT_ACTIONS,
    typeName: 'AuditAction',
    constraint: 'audit_action_check',
  },
  ACTOR_VIA: {
    terms: ACTOR_VIA,
    typeName: 'ActorVia',
    constraint: 'audit_via_check',
    alsoConstraints: ['history_imported_via_check'],
  },
  HISTORY_SOURCES: {
    terms: HISTORY_SOURCES,
    typeName: 'HistorySource',
    constraint: 'history_source_check',
  },
  HISTORY_STATUSES: {
    terms: HISTORY_STATUSES,
    typeName: 'HistoryStatus',
    constraint: 'history_status_check',
  },
}

/**
 * Vocabularies with only two copies, and the reason each has no third.
 *
 * Listed rather than omitted, so "this one is not checked" is a decision a
 * reader can see rather than an absence they have to notice.
 */
const TWO_COPIES: Record<string, string> = {
  MEMBER_ROLES:
    'the CHECK is `billing_workspace_members_role_check` in 0001 and there is no TS union: ' +
    'the platform layer types a role as `\'owner\' | \'member\'` already, in ' +
    'packages/platform-api, and a second union here would be the copy this guard exists ' +
    'to prevent',
  INVITATION_STATUSES:
    'the CHECK is `billing_invitations_status_check` in 0001 and no route of this app ' +
    'assigns one: invitations are served by the platform factories, which own their own ' +
    'types',
}

/** The values a TypeScript union declares: `type X = 'a' | 'b'`. */
function unionValues(typeName: string): string[] {
  const re = new RegExp(`export type ${typeName}\\s*=([^\\n]*(?:\\n\\s*\\|[^\\n]*)*)`)
  const m = re.exec(TYPES)
  if (!m) return []
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

/**
 * The values a named CHECK constraint permits: `… IN ('a', 'b')`.
 *
 * ── THE `(?![\w])` IS NOT DECORATION ───────────────────────────────────────
 * Without it the name matches as a PREFIX, so renaming `invoice_status_check` to
 * `invoice_status_check_renamed` left this function still finding it — and the
 * guard passed while the constraint it names had moved. Found by mutation, not
 * by review: it was the fourth of four injections, and the only one that came
 * back green.
 *
 * That is the vacuous-pass shape the `expect(check.length)` assertion below was
 * written to catch, defeated by the lookup succeeding against the wrong thing.
 * CLAUDE.md finding #17 is the same mechanism through a rename.
 */
function constraintValues(name: string): string[] {
  const re = new RegExp(`CONSTRAINT\\s+${name}(?![\\w])[\\s\\S]{0,400}?IN\\s*\\(([^)]*)\\)`, 'i')
  const m = re.exec(MIGRATIONS)
  if (!m) return []
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

describe('every closed vocabulary agrees in all three places', () => {
  it('found all three files (guards against a vacuous pass)', () => {
    expect(TYPES.length, 'types/index.ts read as empty').toBeGreaterThan(0)
    expect(MIGRATIONS.length, 'no .sql files found under lib/db/migrations').toBeGreaterThan(0)
    expect(Object.keys(TRIPLES).length, 'TRIPLES is empty').toBeGreaterThan(0)
  })

  for (const [name, t] of Object.entries(TRIPLES)) {
    it(`${name}: served list, TS union and CHECK constraint match`, () => {
      const served = t.terms.map((x) => x.value).sort()
      const union = unionValues(t.typeName).sort()
      const check = constraintValues(t.constraint).sort()

      // Assert each side was FOUND before comparing. An empty union and an
      // empty constraint would compare equal to each other and report nothing,
      // which is the vacuous pass this whole file is written against.
      expect(union.length, `no union found for \`export type ${t.typeName}\` in types/index.ts`).toBeGreaterThan(0)
      expect(
        check.length,
        `no \`CONSTRAINT ${t.constraint} … IN (…)\` found in any migration`
      ).toBeGreaterThan(0)

      expect(union, `types/index.ts's ${t.typeName} disagrees with lib/vocabularies.ts`).toEqual(served)
      expect(check, `migration CHECK ${t.constraint} disagrees with lib/vocabularies.ts`).toEqual(served)

      for (const also of t.alsoConstraints ?? []) {
        const more = constraintValues(also).sort()
        expect(more.length, `no \`CONSTRAINT ${also} … IN (…)\` found in any migration`).toBeGreaterThan(0)
        expect(more, `migration CHECK ${also} disagrees with lib/vocabularies.ts`).toEqual(served)
      }
    })
  }

  it('every two-copy vocabulary still has its CHECK, and says why it has no union', () => {
    for (const [name, reason] of Object.entries(TWO_COPIES)) {
      expect(reason.length, `${name}'s exemption has no reason`).toBeGreaterThan(40)
    }
    // The CHECKs those two rely on must still exist, or the exemption has quietly
    // become "enforced nowhere".
    expect(constraintValues('billing_workspace_members_role_check').sort()).toEqual([
      'member',
      'owner',
    ])
    expect(constraintValues('billing_invitations_status_check').sort()).toEqual([
      'accepted',
      'expired',
      'pending',
      'revoked',
    ])
  })
})

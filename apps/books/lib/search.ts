// One free-text filter, over rows this screen already holds.
//
// ===========================================================================
// THIS IS A FILTER OVER ROWS IN HAND, NEVER A REQUEST
// ===========================================================================
// `GET …/rules` and `GET …/sources` each serve their whole list — nineteen rows
// and nine — and neither route takes a query parameter. So a search box over
// either is arithmetic on data already fetched, and it must not become a hook:
// a client-side filter over a TRUNCATED list silently searches the wrong set,
// which is the limit `components/data-table.tsx` already writes down about its
// own sort. **If either list ever paginates, this module is wrong and the
// answer is a `?q=` on the route.**
//
// ===========================================================================
// WHICH FIELDS ARE SEARCHED IS A DECISION, SO IT IS A VALUE, NOT A LOOP
// ===========================================================================
// A search that quietly reads fewer fields than the reader can see returns a
// shorter list than the screen justifies, and nothing about it looks wrong. So
// the fields are enumerated per row type, here, next to a test that names them
// — rather than derived by walking the object, which would sweep in ids,
// booleans and window sizes and match a rule on the digits of its tolerance.
//
// The rule is: **a field is searchable if it is rendered.** `ruleFields` and
// `sourceFields` below are each a list of what their table's cells show, and
// `lib/search.test.ts` fails if one of them stops covering a column.

import type { RecognitionRule, Source } from './types'
import type { StatementLabel } from './statements'

/** Resolves a `{fr, en}` pair to the reader's side — `useLabel()`'s return. */
export type LabelFn = (label: StatementLabel | null | undefined) => string

/**
 * The query as it will be compared: trimmed, folded to lower case.
 *
 * Accents are NOT stripped. A French book's counterparties are written with
 * them and a reader typing `dépenses` must not be told there is nothing there;
 * stripping would also mean `resume` matching `résumé`, which is a different
 * word. Folding case is the one normalisation that is uncontroversial in both
 * languages this app speaks.
 */
export function normalizeQuery(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase()
}

/**
 * Does any of these fields contain the query?
 *
 * An EMPTY query matches everything — the screen shows the unfiltered list, and
 * a box nobody typed in must never hide a row. This is the case that a naive
 * `includes()` gets right by accident and that a "smarter" implementation
 * breaks, so it is asserted first in the test.
 */
export function matchesQuery(
  fields: ReadonlyArray<string | number | null | undefined>,
  query: string
): boolean {
  const q = normalizeQuery(query)
  if (q === '') return true
  return fields.some((f) => f !== null && f !== undefined && String(f).toLowerCase().includes(q))
}

/**
 * Everything `<RulesPanel>`'s table puts on screen for one rule.
 *
 * The source is included as the digits of its #number, because the cell prints
 * `source 3` and a reader who can see `3` may reasonably type it. It is NOT
 * included as a bare number in the same list as the amounts, for the reason in
 * the header: the pattern's amount and tolerance are a match WINDOW rather than
 * anything printed as a searchable word, and folding them in would make `50`
 * match half the table.
 */
export function ruleFields(rule: RecognitionRule, label: LabelFn): (string | null)[] {
  return [
    rule.pattern.counterparty,
    label(rule.explanation),
    label(rule.note),
    rule.account,
    rule.learned_from,
    rule.source === null ? null : `source ${rule.source}`,
    rule.pattern.interval ?? null,
  ]
}

/** Everything `<SourceRegister>`'s table puts on screen for one source. */
export function sourceFields(source: Source, label: LabelFn): (string | null)[] {
  return [
    source.name,
    source.type,
    source.layer,
    source.entity,
    source.method,
    source.status,
    source.expected,
    label(source.notes_freeform),
    ...source.ledger_accounts,
  ]
}

/** The rows that match, in the order they arrived. */
export function filterRows<T>(
  rows: T[] | undefined,
  query: string,
  fields: (row: T) => ReadonlyArray<string | number | null | undefined>
): T[] | undefined {
  if (!rows) return rows
  if (normalizeQuery(query) === '') return rows
  return rows.filter((r) => matchesQuery(fields(r), query))
}

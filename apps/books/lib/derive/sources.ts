// Source completeness: computed, never hand-toggled.
//
// ===========================================================================
// A STATUS COLUMN WOULD KILL THE SIGNAL THIS REGISTER EXISTS FOR
// ===========================================================================
// The register answers "do I have everything". That answer is only trustworthy
// while nobody can set it: the moment `status` is a column, somebody flips one
// to green during a busy week and the completeness signal reports feelings.
// So status is a FUNCTION of `expected` cadence against `last_import`, and the
// only hand-set lifecycle fact is `retired` (phase-3-sources-pieces.md).
//
// Ported from the mockup's `sourceWindows`/`sourceStatus`
// (`bbooks-data.js`, just above the PT_DATA export). `sources.test.ts` holds
// this port against the reference across every seeded source at the mockup's
// own TODAY, so a drifted threshold fails rather than lingers.
//
// Pure throughout: `today` is a PARAMETER. A derivation that reads the clock
// itself cannot be tested honestly, and two calls in one render could even
// disagree across midnight.

/** The slice of a source that completeness is derived from. */
export interface SourceForStatus {
  expected: string | null
  last_import: string | null
  retired: boolean
}

export type SourceStatus = 'current' | 'stale' | 'gap' | 'never_connected' | 'retired'

export interface SourceWindows {
  stale_after_days: number
  gap_after_days: number
}

/**
 * Failure semantics per cadence. ONE map shared by the computed status and any
 * display, so "stale" and "gap detected" always mean the same operational
 * thing. Gap is twice stale, per the reference.
 */
export function sourceWindows(expected: string | null): SourceWindows {
  const windows: Record<string, number> = { daily: 2, weekly: 10, monthly: 40, quarterly: 100 }
  const w = (expected && windows[expected]) || 40
  return { stale_after_days: w, gap_after_days: w * 2 }
}

/** Whole days between two ISO dates, rounded as the reference rounds. */
function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86400000)
}

/**
 * The completeness verdict, in the reference's exact precedence:
 * retired > never connected > no expectation > gap > stale > current.
 *
 * `expected: 'none'` (or absent) means "no flow is expected" — the frozen UBS
 * relationship is CURRENT with a June import because nothing more should
 * arrive, which is precisely the difference between "quiet" and "late".
 */
export function sourceStatus(src: SourceForStatus, today: string): SourceStatus {
  if (src.retired) return 'retired'
  if (!src.last_import) return 'never_connected'
  if (!src.expected || src.expected === 'none') return 'current'
  const days = daysBetween(src.last_import, today)
  const w = sourceWindows(src.expected)
  if (days > w.gap_after_days) return 'gap'
  if (days > w.stale_after_days) return 'stale'
  return 'current'
}

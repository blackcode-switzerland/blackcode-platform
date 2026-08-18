// The completeness port agrees with the mockup's verdicts, source by source.
//
// Same discipline as parity.test.ts: the reference (`sourceWindows` /
// `sourceStatus` in bbooks-data.js) is re-implemented here in its own float
// style, run over every seeded source AT THE MOCKUP'S OWN `TODAY`, and the
// real implementation must agree. The thresholds are judgment calls (10 days
// for weekly, 2x for gap) — exactly the kind of number that drifts silently
// in a port, and exactly what a wrong completeness verdict hides.

import { describe, it, expect } from 'vitest'
import { sourceStatus, sourceWindows } from './sources'
import fixture from '../../fixtures/mockup.json'

interface FxSource { id: number; expected: string | null; last_import: string | null; retired: boolean }
const F = fixture as unknown as { TODAY: string; SOURCES: FxSource[] }

// The reference, as the mockup wrote it.
function refStatus(src: FxSource, today: string): string {
  if (src.retired) return 'retired'
  if (!src.last_import) return 'never_connected'
  if (src.expected === 'none' || !src.expected) return 'current'
  const windows: Record<string, number> = { daily: 2, weekly: 10, monthly: 40, quarterly: 100 }
  const w = windows[src.expected] || 40
  const days = Math.round((new Date(today).getTime() - new Date(src.last_import).getTime()) / 86400000)
  if (days > w * 2) return 'gap'
  if (days > w) return 'stale'
  return 'current'
}

describe('sourceStatus against the mockup', () => {
  it('is not testing air, and covers more than one verdict', () => {
    expect(F.SOURCES.length).toBeGreaterThan(5)
    const verdicts = new Set(F.SOURCES.map((s) => refStatus(s, F.TODAY)))
    expect(verdicts.size, 'the fixture no longer exercises multiple statuses').toBeGreaterThan(1)
  })

  it('agrees with the reference on every seeded source at the mockup TODAY', () => {
    for (const s of F.SOURCES) {
      expect(sourceStatus(s, F.TODAY), `source ${s.id} (expected=${s.expected}, last=${s.last_import})`).toBe(
        refStatus(s, F.TODAY)
      )
    }
  })

  it('walks one source through its whole lifecycle', () => {
    const weekly = { expected: 'weekly', last_import: '2026-08-01', retired: false }
    expect(sourceStatus(weekly, '2026-08-11'), '10 days: on the boundary, still current').toBe('current')
    expect(sourceStatus(weekly, '2026-08-12'), '11 days: one over').toBe('stale')
    expect(sourceStatus(weekly, '2026-08-21'), '20 days: on the gap boundary, still stale').toBe('stale')
    expect(sourceStatus(weekly, '2026-08-22'), '21 days').toBe('gap')
    expect(sourceStatus({ ...weekly, retired: true }, '2026-08-22'), 'retired beats everything').toBe('retired')
    expect(sourceStatus({ ...weekly, last_import: null }, '2026-08-22')).toBe('never_connected')
  })

  it('treats "nothing expected" as current, however old the import (the frozen UBS case)', () => {
    expect(sourceStatus({ expected: 'none', last_import: '2026-06-12', retired: false }, '2026-08-10')).toBe('current')
  })

  it('shares one windows map between status and display', () => {
    expect(sourceWindows('daily')).toEqual({ stale_after_days: 2, gap_after_days: 4 })
    expect(sourceWindows('weekly')).toEqual({ stale_after_days: 10, gap_after_days: 20 })
    expect(sourceWindows('monthly')).toEqual({ stale_after_days: 40, gap_after_days: 80 })
    expect(sourceWindows('quarterly')).toEqual({ stale_after_days: 100, gap_after_days: 200 })
    expect(sourceWindows('something-new'), 'unknown cadence falls back to monthly-ish').toEqual({
      stale_after_days: 40,
      gap_after_days: 80,
    })
  })
})

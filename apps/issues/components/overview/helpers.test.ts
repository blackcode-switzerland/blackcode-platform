import { describe, expect, it } from 'vitest'
import type { LeaderboardMember } from '@/lib/db/queries/overview'
import { activityHref, defaultDir, describeActivity, formatHours, podiumMembers, sortMembers } from './helpers'

const stats = (completed: number, rank: number, cycle: number | null = null) => ({
  created: 0, completed, comments: 0, activity: 0, avg_cycle_time_hours: cycle, rank,
})
function member(id: number, name: string, completed: number, rank: number, cycle: number | null = null): LeaderboardMember {
  const p = stats(completed, rank, cycle)
  return {
    user_id: id, name, email: `${name}@x.io`, avatar_url: null, role: 'member', open_assigned: id, spark: [completed],
    periods: { range: p, this_week: p, this_month: p, last_month: p, this_year: p, last_year: p, all_time: p },
  }
}
const ms = [member(1, 'Cy', 5, 1, 30), member(2, 'Al', 3, 2, null), member(3, 'Bo', 0, 3, 10)]

describe('formatHours', () => {
  it('formats', () => {
    expect(formatHours(null)).toBe('—')
    expect(formatHours(0.2)).toBe('<1h')
    expect(formatHours(47.6)).toBe('48h')
    expect(formatHours(72)).toBe('3.0d')
  })
})
describe('sortMembers', () => {
  it('sorts by name asc', () => {
    expect(sortMembers(ms, 'range', 'name', 'asc').map((m) => m.name)).toEqual(['Al', 'Bo', 'Cy'])
  })
  it('sinks missing cycle times in both directions', () => {
    expect(sortMembers(ms, 'range', 'cycle', 'asc').map((m) => m.name)).toEqual(['Bo', 'Cy', 'Al'])
    expect(sortMembers(ms, 'range', 'cycle', 'desc').map((m) => m.name)).toEqual(['Cy', 'Bo', 'Al'])
  })
  it('does not mutate and ties fall back to rank', () => {
    const before = ms.map((m) => m.name)
    sortMembers(ms, 'range', 'created', 'desc')
    expect(ms.map((m) => m.name)).toEqual(before)
    expect(sortMembers(ms, 'range', 'created', 'desc').map((m) => m.name)).toEqual(['Cy', 'Al', 'Bo'])
  })
  it('default dirs', () => {
    expect(defaultDir('rank')).toBe('asc')
    expect(defaultDir('completed')).toBe('desc')
  })
})
describe('podiumMembers', () => {
  it('excludes members with nothing completed', () => {
    expect(podiumMembers(ms, 'range').map((m) => m.name)).toEqual(['Cy', 'Al'])
  })
})
describe('describeActivity', () => {
  it('appends targets and falls back', () => {
    expect(describeActivity({ action: 'status_changed', to: 'done' })).toEqual({ before: 'changed the status of', after: 'to Done' })
    expect(describeActivity({ action: 'priority_changed', to: 1 }).after).toBe('to Urgent')
    expect(describeActivity({ action: 'weird_thing', to: null })).toEqual({ before: 'weird thing', after: '' })
  })
})
describe('activityHref', () => {
  const row = { entity_type: 'issue', entity_seq: 4, linkable: true } as never
  it('links live subjects only', () => {
    expect(activityHref('ws', row)).toBe('/dashboard/ws/issues/4')
    expect(activityHref('ws', { ...(row as object), linkable: false } as never)).toBeNull()
    expect(activityHref('ws', { ...(row as object), entity_type: 'label' } as never)).toBeNull()
  })
})

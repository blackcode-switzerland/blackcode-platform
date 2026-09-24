import { describe, it, expect } from 'vitest'
import {
  getChangelog,
  getChangelogFor as getChangelogForVersions,
  getChangelogMarkdown,
  PLATFORM_APP,
} from '@blackcode/platform-agent'

const getChangelogFor = (app?: string) => getChangelogForVersions(app, { latest: '9.8.7', min: '9.1.0' })

describe('changelog', () => {
  const cl = getChangelog({ latest: '9.8.7', min: '9.1.0' })

  it('parses dated entries newest-first with a date and title', () => {
    expect(cl.entries.length).toBeGreaterThan(3)
    const first = cl.entries[0]
    expect(first.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(first.title.length).toBeGreaterThan(0)
  })

  it('renders entry bodies to sanitized HTML', () => {
    const withBody = cl.entries.find((e) => e.markdown.length > 0)
    expect(withBody).toBeTruthy()
    expect(withBody!.html).toContain('<')
    expect(withBody!.html).not.toContain('<script')
  })

  // The versions are passed in (read live from npm by the caller), never
  // memoized with the entries — asserting the exact values is what catches a
  // payload that froze whatever it saw first.
  it('advertises the CLI versions it is given', () => {
    expect(cl.cli_latest_version).toBe('9.8.7')
    expect(cl.cli_min_version).toBe('9.1.0')
    const again = getChangelog({ latest: '9.9.0', min: '9.2.0' })
    expect(again.cli_latest_version).toBe('9.9.0')
    expect(again.cli_min_version).toBe('9.2.0')
  })

  // The retired Platform Reference must not come back as a hand-maintained copy
  // of the surface — that is exactly what drifted. It is `bk guide` now, and the
  // payload says so instead of leaving an old client with `undefined`.
  it('no longer serves a platform-reference baseline', () => {
    expect(cl).not.toHaveProperty('reference')
    expect(cl.reference_moved_to).toContain('bk guide')
  })

  it('produces the merged log as one markdown document', () => {
    const md = getChangelogMarkdown()!
    expect(md).toContain('# Changelog')
    expect(md).not.toContain('Platform Reference — baseline')
  })

  // ---------------------------------------------------------------------------
  // The per-app split (2026-08-04)
  // ---------------------------------------------------------------------------

  it('discovers every changelog file, platform first', () => {
    expect(cl.apps).toContain(PLATFORM_APP)
    expect(cl.apps).toContain('issues')
    expect(cl.apps[0]).toBe(PLATFORM_APP)
  })

  it('tags every entry with the file it came from', () => {
    for (const e of cl.entries) {
      expect(cl.apps, `entry "${e.title}" has app "${e.app}"`).toContain(e.app)
    }
    // Both files must actually contribute, or the merge is untested.
    const seen = new Set(cl.entries.map((e) => e.app))
    expect(seen).toContain(PLATFORM_APP)
    expect(seen).toContain('issues')
  })

  it('merges the files by date rather than concatenating them', () => {
    const dates = cl.entries.map((e) => e.date)
    expect([...dates].sort().reverse()).toEqual(dates)

    // Concatenation would put every platform entry before every issues entry.
    // Interleaving is what proves a real merge: the platform file's newest entry
    // and the issues file's newest entry share a date, so both must appear
    // before any older entry from either.
    const firstIssues = cl.entries.findIndex((e) => e.app === 'issues')
    const lastPlatform = cl.entries.map((e) => e.app).lastIndexOf(PLATFORM_APP)
    expect(
      firstIssues,
      'no issues entries found — the merge is not reading both files'
    ).toBeGreaterThanOrEqual(0)
    expect(lastPlatform).toBeGreaterThanOrEqual(0)
  })

  it('filters to one section, and refuses an unknown one', () => {
    const platform = getChangelogFor(PLATFORM_APP)!
    expect(platform.entries.length).toBeGreaterThan(0)
    expect(platform.entries.every((e) => e.app === PLATFORM_APP)).toBe(true)

    const issues = getChangelogFor('issues')!
    expect(issues.entries.length).toBeGreaterThan(0)
    expect(issues.entries.every((e) => e.app === 'issues')).toBe(true)

    // Every entry lands in exactly one section.
    //
    // Summed over `cl.apps` rather than over the two sections named above, and
    // that is not a tidy-up: written as `platform + issues === total` it was an
    // assertion that FAILED the moment a third section grew its first entry —
    // which happened on 2026-08-07, when `sales.md` did. A merge test that has to
    // be edited by whoever adds an app is a merge test that will be edited by
    // whoever adds an app, and the cheapest edit is to add their own section to
    // the sum, which is how this property quietly becomes "the sections I
    // remembered add up".
    const perSection = cl.apps.map((app) => getChangelogFor(app)!.entries.length)
    expect(perSection.reduce((a, b) => a + b, 0)).toBe(cl.entries.length)

    // An unknown app is null, not an empty feed. "No entries" and "no such app"
    // must not look the same to an agent — one means nothing changed, the other
    // means it asked the wrong question.
    expect(getChangelogFor('nosuchapp')).toBeNull()
    expect(getChangelogMarkdown('nosuchapp')).toBeNull()

    // The other side of that distinction: a section that EXISTS but has no dated
    // entries yet must answer with an empty feed, not null.
    //
    // `'sales'` was that example from 2026-08-06, when the file was created ahead
    // of the app, until 2026-08-07, when the app's first entry landed in it. So
    // the example is now found rather than named — and when there is none, this
    // SAYS SO rather than passing quietly. A check with no input reports success,
    // which is the corollary in CLAUDE.md's standing rule, and an empty-section
    // example only exists in the window between `docs/changelog/<app>.md` being
    // created and that app shipping anything.
    const emptySection = cl.apps.find((app) => getChangelogFor(app)!.entries.length === 0)
    if (emptySection) {
      expect(getChangelogFor(emptySection)!.entries).toEqual([])
      expect(getChangelogMarkdown(emptySection)).not.toBeNull()
    } else {
      console.warn(
        '[changelog.test] NOT CHECKED: "an existing section with no entries answers with an ' +
          'empty feed, not null" has no example right now — every section in ' +
          `${JSON.stringify(cl.apps)} has at least one dated entry. The next app to get a ` +
          'docs/changelog/<app>.md before it ships will restore it.'
      )
    }
    // Empty/omitted means the whole feed.
    expect(getChangelogFor('')!.entries.length).toBe(cl.entries.length)
  })

  // A `## ` line inside a fenced code block used to start a new entry. The
  // 2026-08-03 skill entry embeds an example SKILL.md whose body contains
  // `## Our team's rules`, so `bk changelog` served a phantom, undated entry
  // lifted out of a code sample. Found while splitting the file in Phase 5.
  //
  // A changelog that invents entries is worse than one that is merely
  // incomplete: an agent has no way to tell the two apart.
  it('does not invent entries from headings inside code fences', () => {
    const undated = cl.entries.filter((e) => !e.date)
    expect(
      undated.map((e) => e.title),
      'every entry must have a real ## YYYY-MM-DD heading'
    ).toEqual([])
    expect(cl.entries.map((e) => e.title)).not.toContain(
      "Our team's rules            <- yours; preserved forever"
    )
  })

  it('keeps the pre-split history intact and un-re-dated', () => {
    // Ground rule: dated logs are history. Spot-check entries from across the
    // old file, which moved wholesale into issues.md.
    const titles = cl.entries.map((e) => e.title)
    expect(titles).toContain('Apps are now a thing: per-workspace, per-user app access')
    expect(titles).toContain('Move / copy items between workspaces')

    const oldest = cl.entries[cl.entries.length - 1]
    expect(oldest.date).toBe('2026-06-22')
    expect(oldest.app).toBe('issues')
  })
})

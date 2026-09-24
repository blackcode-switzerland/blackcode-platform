// Single source of truth for the product changelog, surfaced two aligned ways:
// `bk changelog` and GET /api/changelog. Both read docs/changelog/*.md — one
// file per app plus platform.md — and merge them by date into a single
// newest-first feed, each entry tagged with the app it belongs to. Each entry is
// a `## YYYY-MM-DD — Title` section.
//
// Split from the single docs/api-changelog.md on 2026-08-04 (Phase 5). One file
// per app because a single file becomes a merge-conflict magnet across app teams
// and does not survive an app extraction; one merged feed because an agent
// should not have to know how many apps exist to find out what changed.
//
// The /changelog web page was removed on 2026-08-03: it had no human audience,
// and a page nobody reads is still a page somebody has to keep honest. The
// changelog is an AGENT surface now.
//
// It used to also serve docs/platform-reference.md, a pinned "complete snapshot
// of the API + CLI surface". That document is gone: a hand-maintained snapshot of
// a surface is a copy, and copies drift — its CLI version was already stale when
// we retired it. The current surface is now described by `bk guide`, which ships
// inside the binary and therefore always matches the binary being run.
//
// So the changelog has exactly one job now: the dated record of what changed.
// For how things WORK, an agent runs `bk guide`; for live values, `bk meta`.
//
// The file is the editable source; this module reads, parses, and renders it. It
// is bundled into the serverless output via next.config.js
// (outputFileTracingIncludes) so the reads work in production too.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'
import type { CliVersions } from './cli-version'

// The changelog lives at the MONOREPO ROOT (`docs/changelog/`), not inside this
// app — architecture §7.3 makes it a platform surface merging one file per app
// into a single feed. `outputFileTracingRoot` + `outputFileTracingIncludes` in
// next.config.js are what carry the files into the serverless bundle; keep the
// two in step.
//
// Resolution walks UP from the working directory rather than assuming a fixed
// `../../`. It has to start from cwd — in a Next serverless bundle the module
// lives under `.next/server/...` while the traced files land relative to the
// app root, so resolving from the module's own path would find nothing in
// production. But hardcoding two levels made this module silently
// cwd-dependent: it worked because turbo happens to run vitest with cwd set to
// `apps/issues`, and threw ENOENT from the repo root. That is the same
// fragility cli-parity.test.ts was carrying, found the same week.
function findChangelogDir(): string {
  let dir = process.cwd()
  for (;;) {
    const candidate = join(dir, 'docs', 'changelog')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) {
      // Fall back to the historical guess so the failure names the path it
      // wanted, rather than an empty string.
      return join(process.cwd(), '..', '..', 'docs', 'changelog')
    }
    dir = parent
  }
}

const CHANGELOG_DIR = findChangelogDir()

/** The section a changelog file belongs to, when it is not an app. */
export const PLATFORM_APP = 'platform'

export interface ChangelogEntry {
  /** ISO date `YYYY-MM-DD` parsed from the entry heading (empty if unparseable). */
  date: string
  /**
   * Which file this came from: `platform`, or an app slug. Added 2026-08-04 with
   * the split; every entry has one.
   */
  app: string
  /** The entry title (the heading text after the date). */
  title: string
  /** The entry body Markdown (without the `## heading` line). */
  markdown: string
  /** The entry body rendered to sanitized HTML. */
  html: string
}

export interface ChangelogPayload {
  /** Newest published CLI; older clients get a soft "update available" notice. */
  cli_latest_version: string
  /** Minimum CLI the API still supports; older clients are hard-blocked. */
  cli_min_version: string
  /** Every section with a changelog file: `platform` first, then each app. */
  apps: string[]
  /** Every dated change, newest first, merged across docs/changelog/*.md. */
  entries: ChangelogEntry[]
  /**
   * Where the retired Platform Reference went. Kept in the payload (rather than
   * silently dropping the field) so a client built against the old shape gets an
   * answer instead of `undefined` — the same reasoning as the 410 stubs.
   */
  reference_moved_to: string
}

// We author the changelog; this is not untrusted user input. We still sanitize
// (defense in depth) with the same tag/attribute whitelist the rich-text layer
// uses, so the rendered HTML can drop straight into a `.prose` container.
const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr', 'blockquote',
    'strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark', 'sub', 'sup',
    'code', 'pre',
    'ul', 'ol', 'li',
    'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'span', 'div',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    '*': ['id', 'class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
}

// gfm for tables/strikethrough; breaks:false so the hard-wrapped prose in the
// source files renders as flowing paragraphs (not a <br> per wrapped line).
function render(md: string): string {
  const html = marked.parse(md, { async: false, gfm: true, breaks: false }) as string
  return sanitizeHtml(html, SANITIZE_OPTS)
}

// Split one file's dated log into entries. Everything before the first `## `
// heading (the file title + intro) is dropped; each `## YYYY-MM-DD — Title`
// starts a new entry, and trailing `---` separators / whitespace are trimmed
// from each body.
//
// Splitting is FENCE-AWARE, and that is not a nicety. Splitting on a bare
// `/\n(?=## )/` treated a `## ` line inside a fenced code block as a new entry:
// the 2026-08-03 skill entry contains an example SKILL.md whose body has a
// `## Our team's rules` line, and `bk changelog` had been serving that as a
// phantom, undated entry ever since. Found while splitting the file in Phase 5.
// A changelog that invents entries is worse than one that is merely incomplete —
// an agent has no way to tell the difference.
function splitSections(md: string): string[] {
  const out: string[] = []
  let current: string[] | null = null
  let inFence = false
  let fence = ''

  for (const line of md.split('\n')) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!inFence) {
        inFence = true
        fence = marker[0]
      } else if (marker[0] === fence) {
        inFence = false
      }
    }

    if (!inFence && /^## /.test(line)) {
      if (current) out.push(current.join('\n'))
      current = [line]
      continue
    }
    if (current) current.push(line)
  }
  if (current) out.push(current.join('\n'))
  return out
}

function parseEntries(md: string, app: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  for (const section of splitSections(md)) {
    const m = section.match(/^##\s+(.+?)\r?\n([\s\S]*)$/)
    if (!m) continue
    const heading = m[1].trim()
    const rest = m[2].replace(/\n+---\s*$/, '').trim()
    const dated = heading.match(/^(\d{4}-\d{2}-\d{2})\s*[—-]\s*(.+)$/)
    entries.push({
      date: dated ? dated[1] : '',
      app,
      title: (dated ? dated[2] : heading).trim(),
      markdown: rest,
      html: render(rest),
    })
  }
  return entries
}

/**
 * The changelog files on disk, as `{ app, markdown }`, platform first then each
 * app alphabetically. Discovering them by reading the directory means adding an
 * app is adding a file — no registry to keep in step.
 */
function readSources(): Array<{ app: string; markdown: string }> {
  const files = readdirSync(CHANGELOG_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .sort((a, b) => {
      if (a === PLATFORM_APP) return -1
      if (b === PLATFORM_APP) return 1
      return a.localeCompare(b)
    })
  return files.map((app) => ({
    app,
    markdown: readFileSync(join(CHANGELOG_DIR, `${app}.md`), 'utf8'),
  }))
}

/**
 * Merge every file's entries into one newest-first feed.
 *
 * Sorted by date descending. Same-date ties keep each file's own order, and keep
 * that file's entries together: several entries dated the same day were written
 * as a sequence that reads top to bottom, and both interleaving them with
 * another file's and re-sorting them alphabetically would scramble that. So the
 * tie-break is (which file, then position within it) — platform first, since
 * that is the order readSources returns.
 */
function mergeEntries(sources: Array<{ app: string; markdown: string }>): ChangelogEntry[] {
  const all = sources.flatMap((s, file) =>
    parseEntries(s.markdown, s.app).map((e, i) => ({ e, file, i }))
  )
  all.sort((x, y) => {
    if (x.e.date !== y.e.date) return x.e.date < y.e.date ? 1 : -1
    if (x.file !== y.file) return x.file - y.file
    return x.i - y.i
  })
  return all.map(({ e }) => e)
}

// Read once and memoize. In production the files never change under the running
// process; in dev, editing a doc triggers a module reload which clears this.
//
// Only the ENTRIES are memoized. The CLI versions are passed in by the caller
// (from `getCliVersions()`) on every call, because they are read live from npm
// and memoizing them here would freeze whatever this instance saw first.
let cached: Omit<ChangelogPayload, 'cli_latest_version' | 'cli_min_version'> | null = null

function getFeed() {
  if (cached) return cached
  const sources = readSources()
  cached = {
    apps: sources.map((s) => s.app),
    entries: mergeEntries(sources),
    reference_moved_to: 'Run `bk guide` — the complete usage guide, embedded in the CLI binary.',
  }
  return cached
}

/** Every section with a changelog file: `platform` first, then each app. */
export function getChangelogApps(): string[] {
  return getFeed().apps
}

export function getChangelog(versions: Pick<CliVersions, 'latest' | 'min'>): ChangelogPayload {
  return {
    cli_latest_version: versions.latest,
    cli_min_version: versions.min,
    ...getFeed(),
  }
}

/**
 * The feed filtered to one section, or the whole thing when `app` is empty.
 * Returns null for a section that has no file, so the caller can 404 with the
 * valid names rather than serving a silently empty list — "no entries" and "no
 * such app" must not look the same to an agent.
 */
export function getChangelogFor(
  app: string | null | undefined,
  versions: Pick<CliVersions, 'latest' | 'min'>
): ChangelogPayload | null {
  const full = getChangelog(versions)
  const want = (app ?? '').trim().toLowerCase()
  if (!want) return full
  if (!full.apps.includes(want)) return null
  return { ...full, entries: full.entries.filter((e) => e.app === want) }
}

/**
 * The merged log as one Markdown document — used by
 * GET /api/changelog?format=markdown and `bk changelog --full`.
 *
 * Rendered from the parsed entries rather than concatenating the files, because
 * concatenation would put every platform entry above every issues entry
 * regardless of date, which is not what "the changelog" means. Each heading
 * carries its app so the merged document stays attributable.
 */
export function getChangelogMarkdown(app?: string | null): string | null {
  const feed = getFeed()
  const want = (app ?? '').trim().toLowerCase()
  if (want && !feed.apps.includes(want)) return null
  const entries = want ? feed.entries.filter((e) => e.app === want) : feed.entries

  const heading = app ? `# Changelog — ${app}` : '# Changelog'
  const parts = [
    heading,
    '',
    'Merged from docs/changelog/*.md, newest first. Each entry is tagged with the',
    'app it belongs to. For how the CLI works, run `bk guide`; for live values,',
    '`bk meta`.',
    '',
  ]
  for (const e of entries) {
    const date = e.date || 'undated'
    parts.push('---', '', `## ${date} — [${e.app}] ${e.title}`, '', e.markdown, '')
  }
  return `${parts.join('\n').trim()}\n`
}

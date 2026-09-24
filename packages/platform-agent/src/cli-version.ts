// The bk CLI versions the API advertises. Every API response carries them as
// headers (set in packages/platform-api/src/handler.ts), and `bk meta` and the
// changelog feed repeat them:
//
//   X-BK-CLI-Latest  — newest published CLI; the CLI prints a soft "update
//                      available" notice when the user is behind it.
//   X-BK-CLI-Min     — minimum CLI the API still supports; the CLI refuses to
//                      run (hard upgrade, exit 8) when the user is below it.
//
// ---------------------------------------------------------------------------
// NPM IS THE SOURCE OF TRUTH — NOT THIS FILE (since 2026-09-24)
// ---------------------------------------------------------------------------
// Both values are read, at runtime, from the npm dist-tags of the one CLI
// package:
//
//   latest  → the `latest` dist-tag, which `npm publish` moves by itself
//   min     → the `min` dist-tag, which `./devops/release.sh cli` moves on a
//             FORCED release (`npm dist-tag add <pkg>@<version> min`)
//
// Until then the versions were constants in this file, bumped by the release
// script in a commit it made itself — AFTER the first web deploy. So a CLI
// release was "deploy every app, publish, deploy every app AGAIN", and the
// second round of deploys existed only to ship one version string. Reading npm
// ends that: publishing IS advertising, on every app at once, with no deploy.
//
// It also enforces the rule that used to be a warning here — "publish to npm
// BEFORE raising the floor, or every user is locked out with nothing to upgrade
// to". npm refuses to point a dist-tag at a version that was never published,
// so the floor physically cannot lead the release.
//
// Moving or rolling back the floor, with no deploy, from any machine logged in
// to npm:
//
//   npm dist-tag add @blackcode_sa/bc-issues@<version> min
//
// The resolution order, highest first:
//
//   1. BK_CLI_LATEST / BK_CLI_MIN env — an emergency PIN. On Vercel an env
//      change only takes effect on the next deploy, so this is not the way to
//      move a version day to day; it is for when npm itself is the problem.
//   2. npm dist-tags, cached per server instance for CACHE_TTL_MS. The request
//      that finds the cache expired waits for the refresh (never in the
//      background — see getCliVersions). A failed lookup keeps the last good
//      answer, logs one line, and retries after RETRY_AFTER_MS.
//   3. FALLBACK_* below — only when this instance has never reached npm (a cold
//      start during an npm outage) or the `min` tag does not exist.
//
// The FALLBACK_* values are a safety net, NOT the advertised version. Nothing
// bumps them on release and nothing needs to: a stale fallback during an npm
// outage means a missed "update available" nudge for a few minutes, never a
// lockout, because a fallback floor is always an OLD floor.
//
// And `min` is clamped to `latest`: a floor above the newest published version
// would block everyone with no upgrade that satisfies it.

/**
 * The npm package that IS the binary. One name for the whole platform, because
 * there is one binary (`§6`), so it lives beside the version pair rather than in
 * any app: `bk meta` advertises it, the deprecation header names it, and an
 * app's landing page prints the install line from it. It is not brand copy and
 * it is not environment — it is the package a person has to type to get `bk`,
 * and a deployment that showed a different name here would be advertising an
 * install that does not exist. A fork that publishes its own binary changes
 * this line, and every surface that prints it moves together. (Ticket #756.)
 *
 * It is also the package whose npm dist-tags ARE the advertised versions.
 */
export const CLI_NPM_PACKAGE = '@blackcode_sa/bc-issues'

const FALLBACK_LATEST = '5.0.0'
const FALLBACK_MIN = '5.0.0'

const CACHE_TTL_MS = 5 * 60_000
const RETRY_AFTER_MS = 60_000
const FETCH_TIMEOUT_MS = 1_500

const DIST_TAGS_URL = `https://registry.npmjs.org/-/package/${CLI_NPM_PACKAGE}/dist-tags`

export interface CliVersions {
  latest: string
  min: string
  /** Where `latest`/`min` came from — for debugging, never for behaviour. */
  source: 'env' | 'npm' | 'fallback'
}

const SEMVER = /^\d+\.\d+\.\d+$/

function compare(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

/** min never above latest: a floor nobody can reach is a lockout. */
function clamp(latest: string, min: string): string {
  return compare(min, latest) > 0 ? latest : min
}

type Fetch = (url: string, init: { signal: AbortSignal; cache: 'no-store' }) => Promise<Response>

export interface CliVersionSourceOptions {
  fetch?: Fetch
  now?: () => number
  env?: Record<string, string | undefined>
  /** false → never touch the network (tests, offline dev). */
  network?: boolean
  /** Where a failed lookup is reported. */
  warn?: (message: string) => void
}

/**
 * A cached reader of the advertised versions. Exported as a factory so tests
 * can drive the cache with a fake fetch and clock; the app uses the default
 * instance behind `getCliVersions()`.
 */
export function createCliVersionSource(opts: CliVersionSourceOptions = {}) {
  const doFetch: Fetch = opts.fetch ?? ((url, init) => fetch(url, init))
  const now = opts.now ?? Date.now
  const env = opts.env ?? process.env
  const network = opts.network ?? true
  const warn = opts.warn ?? ((m: string) => console.warn(m))

  let last: { latest: string; min: string } | null = null
  let nextRefresh = 0
  let inflight: Promise<void> | null = null

  async function refresh(): Promise<void> {
    try {
      const res = await doFetch(DIST_TAGS_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`npm dist-tags: HTTP ${res.status}`)
      const tags = (await res.json()) as Record<string, unknown>
      const latest = typeof tags.latest === 'string' ? tags.latest : ''
      if (!SEMVER.test(latest)) throw new Error(`npm dist-tags: bad latest ${String(tags.latest)}`)
      // No `min` tag yet is a legitimate state, not an error: keep the fallback.
      const min = typeof tags.min === 'string' && SEMVER.test(tags.min) ? tags.min : FALLBACK_MIN
      last = { latest, min }
      nextRefresh = now() + CACHE_TTL_MS
    } catch (err) {
      // Keep whatever we had. A lookup failure must never change what is
      // advertised — least of all the floor. But say so: a silent failure here
      // is how a stale version went unnoticed on 2026-09-24.
      warn(`[cli-version] npm dist-tags lookup failed, keeping ${last ? 'last good answer' : 'fallback'}: ${String(err)}`)
      nextRefresh = now() + RETRY_AFTER_MS
    }
  }

  return async function getCliVersions(): Promise<CliVersions> {
    const pinLatest = env.BK_CLI_LATEST
    const pinMin = env.BK_CLI_MIN

    if (network && !(pinLatest && pinMin) && now() >= nextRefresh) {
      inflight ??= refresh().finally(() => {
        inflight = null
      })
      // AWAITED, every time the cache has expired — never left running behind
      // the response. That was tried (stale-while-revalidate) and it broke in
      // production on 2026-09-24: Vercel freezes an instance once its response
      // is sent, so the background fetch froze mid-flight, the timeout fired on
      // thaw, the refresh failed, and three of four apps kept advertising 5.0.0
      // for as long as anyone watched. The cost of awaiting is one ~400 ms
      // request per instance per CACHE_TTL_MS, bounded by FETCH_TIMEOUT_MS.
      await inflight
    }

    const latest = pinLatest || last?.latest || FALLBACK_LATEST
    const min = clamp(latest, pinMin || last?.min || FALLBACK_MIN)
    const source = pinLatest || pinMin ? 'env' : last ? 'npm' : 'fallback'
    return { latest, min, source }
  }
}

/**
 * The versions every app advertises. Never reaches the network under test —
 * a unit test that depends on npm being up is a flaky test.
 */
export const getCliVersions = createCliVersionSource({
  network: process.env.NODE_ENV !== 'test',
})

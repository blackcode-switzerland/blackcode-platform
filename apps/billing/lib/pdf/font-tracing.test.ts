// Every route whose bundle contains the PDF renderer ships the font files.
//
// ===========================================================================
// THE FAILURE THIS PREVENTS IS INVISIBLE ON EVERY LAPTOP
// ===========================================================================
// `lib/pdf/fonts.ts` reads two TTF files with `readFileSync(process.cwd() + …)`.
// Next's file tracer follows imports, not string paths, so it does not know the
// files exist: locally they are on disk and everything renders; on Vercel they
// are absent from the function and every render is a 500 (ENOENT). The cure is a
// line per route in `next.config.js`' `outputFileTracingIncludes` — a
// hand-maintained list, which is what this test is for.
//
// It walks each `route.ts`'s imports TRANSITIVELY: a route that reaches
// `lib/pdf/fonts.ts` by any path must be matched by an include key carrying the
// font glob. Matching uses Next's own bundled `picomatch` with Next's own
// options (`collect-build-traces.js`), because a key is a GLOB — and whether
// `[ws]` in one reads as a literal or a character class is not something to
// reason about from memory.
//
// What it CANNOT see: whether Vercel honoured the include. That is read off a
// real build — `.next/server/app/api/**/route.js.nft.json` must name the two
// files — and is recorded in apps/billing/docs/backend.md.
//
// ===========================================================================
// WATCHED FAILING, 2026-09-18 — each restored
// ===========================================================================
//   - the key narrowed to `/api/workspaces/*/invoices/*/pdf` → red, naming every other rendering route
//   - `./lib/pdf/fonts/*.ttf` changed to `*.otf`              → red (the glob is checked, not only the key)
//   - `fonts.ts` renamed in FONTS below                       → "found routes that render" red

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const FONTS = join(ROOT, 'lib/pdf/fonts.ts')

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(ROOT, spec.slice(2)) : spec.startsWith('.') ? join(dirname(from), spec) : null
  if (!base) return null // a package
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

function importsOf(file: string): string[] {
  const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  // `import … from`, `export … from`, `import('…')`, `require('…')`. Type-only
  // imports are erased at build time and pull nothing into a bundle.
  const specs = [
    ...[...code.matchAll(/^\s*(?:import|export)\s+(?!type\s)[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]),
    ...[...code.matchAll(/(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
  ]
  return specs.map((s) => resolveImport(file, s)).filter((f): f is string => f !== null)
}

function reaches(start: string, target: string): boolean {
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const f = queue.pop()!
    if (f === target) return true
    if (seen.has(f)) continue
    seen.add(f)
    queue.push(...importsOf(f))
  }
  return false
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return routeFiles(p)
    return f === 'route.ts' ? [p] : []
  })
}

/** `app/api/x/[ws]/route.ts` → `/api/x/[ws]`, the key `outputFileTracingIncludes` uses. */
const routeKey = (file: string): string => `/${relative(join(ROOT, 'app'), dirname(file))}`

describe('routes that contain the PDF renderer ship its fonts', () => {
  const rendering = routeFiles(join(ROOT, 'app/api')).filter((f) => reaches(f, FONTS)).map(routeKey).sort()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const includes = (require(join(ROOT, 'next.config.js')) as { outputFileTracingIncludes: Record<string, string[]> })
    .outputFileTracingIncludes

  it('found routes that render (guards against a vacuous pass)', () => {
    expect(existsSync(FONTS)).toBe(true)
    expect(rendering).toContain('/api/workspaces/[ws]/invoices/[ref]/pdf')
    expect(rendering).toContain('/api/workspaces/[ws]/invoices/[ref]/send')
    // …and the walk discriminates: a route that renders nothing is not in it.
    expect(rendering).not.toContain('/api/workspaces/[ws]/companies')
    expect(rendering).not.toContain('/api/meta')
  })

  it('each one is listed in next.config.js with the font glob', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const picomatch = require('next/dist/compiled/picomatch') as (g: string, o: object) => (s: string) => boolean
    const fontKeys = Object.keys(includes).filter((k) => includes[k].some((g) => /lib\/pdf\/fonts\/\*\.ttf$/.test(g)))
    const missing = rendering.filter((route) => !fontKeys.some((k) => picomatch(k, { dot: true, contains: true })(route)))
    expect(missing, `add to outputFileTracingIncludes in next.config.js:\n${missing.join('\n')}`).toEqual([])
  })

  it('the glob matches real files', () => {
    const ttf = readdirSync(join(ROOT, 'lib/pdf/fonts')).filter((f) => f.endsWith('.ttf'))
    expect(ttf.sort()).toEqual(['LiberationSans-Bold.ttf', 'LiberationSans-Regular.ttf'])
  })
})

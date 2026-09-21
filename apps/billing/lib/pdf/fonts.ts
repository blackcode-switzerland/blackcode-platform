// The two font files, read once per process.
//
// ── WHY `process.cwd()` AND NOT `import.meta.url` ──────────────────────────
// A Next.js server bundle rewrites module locations, so a path relative to this
// file's URL points into `.next/` after a build and at nothing. The app's root
// is the working directory in `next dev`, `next start`, on Vercel (root
// directory `apps/billing`) and under vitest. The route that serves PDFs (#86)
// must also list `lib/pdf/fonts/**` in `outputFileTracingIncludes`, or Vercel
// will not ship the files — a render that works locally and 500s in production.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let cache: { regular: Uint8Array; bold: Uint8Array } | null = null

export function fontBytes(): { regular: Uint8Array; bold: Uint8Array } {
  if (cache) return cache
  const dir = join(process.cwd(), 'lib', 'pdf', 'fonts')
  cache = {
    regular: readFileSync(join(dir, 'LiberationSans-Regular.ttf')),
    bold: readFileSync(join(dir, 'LiberationSans-Bold.ttf')),
  }
  return cache
}

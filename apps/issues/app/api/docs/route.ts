// Deprecation stub. The Scalar-rendered API reference has been retired along
// with the OpenAPI document it rendered — see app/api/openapi.json/route.ts for
// why this answers 410 and not 404.
//
// Unlike its sibling, this route served HTML, so a human in a browser may land
// here. It answers in whichever form the caller asked for: a readable page for a
// browser, the standard JSON error envelope for anything else.

import { NextRequest, NextResponse } from 'next/server'
import { RETIRED_SURFACE_BODY } from '@/lib/api/retired'

const HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>API reference retired · b/issues</title>
  </head>
  <body style="font-family: ui-sans-serif, system-ui, sans-serif; max-width: 42rem; margin: 4rem auto; padding: 0 1.5rem; line-height: 1.6">
    <h1>The API reference has been retired</h1>
    <p>blackcode issues is now operated through the <code>bk</code> CLI. The HTTP
       API is private plumbing with no public contract.</p>
    <pre style="background:#f4f4f5;padding:1rem;border-radius:.5rem;overflow-x:auto"><code>npm install -g @blackcode_sa/bc-issues
bk login
bk skill install
bk guide</code></pre>
    <p><code>bk guide</code> is the complete usage guide for the binary you just
       installed — it replaces this page, and it can never describe a version you
       are not running.</p>
    <p><a href="/agent-updator">What changed, and what to do about it &rarr;</a></p>
  </body>
</html>`

export function GET(request: NextRequest) {
  if ((request.headers.get('accept') ?? '').includes('text/html')) {
    return new Response(HTML, {
      status: 410,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    })
  }
  return NextResponse.json(RETIRED_SURFACE_BODY, {
    status: 410,
    headers: { 'Cache-Control': 'public, max-age=300' },
  })
}

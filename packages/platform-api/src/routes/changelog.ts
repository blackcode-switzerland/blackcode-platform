// GET /api/changelog — the product changelog, public and unauthenticated so any
// client (or an outdated agent skill) can read how the platform has changed.
//
// Default (JSON):
//   { cli_latest_version, cli_min_version,
//     apps: ['platform', 'issues', …],                  // sections with a file
//     entries: [{ date, app, title, markdown, html }],  // merged, newest first
//     reference_moved_to
//   }
// ?format=markdown (or Accept: text/markdown) returns the log as one raw
// Markdown document.
// ?app=issues filters to one section; an unknown one is a 404 that names the
// valid ones, because "no entries" and "no such app" must not look the same.
//
// The feed is IDENTICAL on every app's origin — it merges docs/changelog/*.md,
// which is the whole repo's record. That is deliberate: an agent should not have
// to know how many apps exist, or which host to ask, to find out what changed.
// So this factory ignores `app.appSlug` entirely, and that is not an oversight.
//
// Source of truth is docs/changelog/*.md, merged by date in
// @blackcode/platform-agent (packages/platform-agent/src/changelog.ts).

import { NextRequest, NextResponse } from 'next/server'
import { getChangelogApps, getChangelogFor, getChangelogMarkdown, getCliVersions } from '@blackcode/platform-agent'
import type { AppContext } from '../app-context'

export function changelogRoute(_app: AppContext) {
  // No apiHandler: this route is public, unauthenticated, and answers before any
  // of the wrapper's machinery would apply. It was that way before the
  // extraction and stays that way — an agent reading the changelog is often an
  // agent whose credentials are the thing that stopped working.
  return async function GET(request: NextRequest) {
    const format = request.nextUrl.searchParams.get('format')
    const appFilter = request.nextUrl.searchParams.get('app')
    const wantsMarkdown =
      format === 'markdown' ||
      format === 'md' ||
      (request.headers.get('accept') ?? '').includes('text/markdown')

    // Public, so it does not go through apiHandler/Errors — but an agent that
    // mistypes --app still gets the shape it knows how to read, suggestion
    // included.
    const known = getChangelogApps()
    if (appFilter && !known.includes(appFilter.trim().toLowerCase())) {
      return NextResponse.json(
        {
          error: `Unknown app '${appFilter}'`,
          code: 'unknown_app',
          suggestion: `Valid values: ${known.join(', ')}. Omit ?app= for the merged feed.`,
        },
        { status: 404 }
      )
    }

    if (wantsMarkdown) {
      return new NextResponse(getChangelogMarkdown(appFilter) ?? '', {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        },
      })
    }

    return NextResponse.json(getChangelogFor(appFilter, await getCliVersions()), {
      headers: { 'Cache-Control': 'public, max-age=300' },
    })
  }
}

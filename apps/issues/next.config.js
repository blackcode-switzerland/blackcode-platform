const path = require('node:path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Monorepo: this app lives at apps/issues, but it reads and bundles files from
  // the repo root (docs/). Next must be told where the workspace root is, or it
  // infers it from the nearest lockfile and refuses to trace files above the app.
  outputFileTracingRoot: path.join(__dirname, '../../'),

  // The platform packages ship TypeScript source, not a build step — Next
  // compiles them as part of this app. Adding a package to apps/issues/package.json
  // is not enough; it must be listed here too or the build fails on `.ts` syntax.
  transpilePackages: [
    '@blackcode/platform-db',
    '@blackcode/platform-api',
    '@blackcode/platform-auth',
    '@blackcode/platform-agent',
    '@blackcode/platform-ui',
  ],

  // The changelog API reads the authored Markdown in the ROOT docs/ at runtime
  // (lib/changelog.ts). Trace that file into the serverless bundle so the reads
  // work in production, not just in local dev. Paths are relative to this app
  // directory, so ../../ reaches the repo root — keep in step with DOCS_DIR in
  // lib/changelog.ts.
  outputFileTracingIncludes: {
    // A glob, not a list: Phase 5 split the log into one file per app plus
    // platform.md, and lib/changelog.ts discovers them by reading the directory.
    // Naming files here individually would mean a new app's changelog builds
    // locally and 500s in production, which is the failure only a real deploy
    // catches.
    '/api/changelog': ['../../docs/changelog/*.md'],
  },
  // TWO LANDING PADS FOR PATHS PEOPLE ACTUALLY TYPED AND GOT A 404 FROM.
  //
  // Both come from Todo/issues-app-feedback.md item 4, where troubleshooting
  // links shared with agents dead-ended:
  //
  //   /agent-updater  the page is spelled `/agent-updator`, and has been since
  //                   it shipped. `updater` is the correct English spelling, so
  //                   it is the one anyone writing the link from memory reaches
  //                   for. Neither is going away and the misspelling is load-
  //                   bearing (it is in the X-BK-Help header, the changelog and
  //                   /api/docs), so this maps the guess onto the real page
  //                   rather than renaming anything.
  //
  //   /changelog      the PAGE was deliberately removed on 2026-08-03 and must
  //                   NOT come back (CLAUDE.md, changelog rule) — it had no
  //                   human audience. But the agent surface it was removed in
  //                   favour of is one path segment away, and a 404 does not
  //                   say so. This sends the caller to that surface; it does
  //                   not resurrect a page.
  //
  // 307, not 308: a permanent redirect gets cached in browsers and by every
  // intermediary, and both of these are pointing at spellings we might yet want
  // to change (the `updator` typo above all). Reversibility is worth the extra
  // round trip on a path nobody hits in a hot loop.
  async redirects() {
    return [
      { source: '/agent-updater', destination: '/agent-updator', permanent: false },
      { source: '/changelog', destination: '/api/changelog', permanent: false },
    ]
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
    ],
  },
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000', 'blackcode-issues.vercel.app'],
    },
  },
}

module.exports = nextConfig

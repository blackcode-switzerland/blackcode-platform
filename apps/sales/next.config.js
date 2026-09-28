const path = require('node:path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Monorepo: this app lives at apps/sales, but it reads and bundles files from
  // the repo root (docs/). Next must be told where the workspace root is, or it
  // infers it from the nearest lockfile and refuses to trace files above the app.
  outputFileTracingRoot: path.join(__dirname, '../../'),

  // The platform packages ship TypeScript source, not a build step — Next
  // compiles them as part of this app. Adding a package to apps/sales/package.json
  // is not enough; it must be listed here too or the build fails on `.ts` syntax.
  //
  // ── AND FOR `@blackcode/platform-ui`, THIS LINE IS ONLY HALF THE WIRING ─────
  // `transpilePackages` makes the TypeScript compile. `@source` in
  // app/globals.css makes the CSS EXIST. Neither implies the other and only this
  // one fails loudly — D-30, and it was a live production bug in apps/issues for
  // months. Both lines, always.
  transpilePackages: [
    '@blackcode/platform-db',
    '@blackcode/platform-api',
    '@blackcode/platform-auth',
    '@blackcode/platform-agent',
    '@blackcode/platform-storage',
    '@blackcode/platform-ui',
  ],

  // The changelog API reads the authored Markdown in the ROOT docs/ at runtime.
  // Trace those files into the serverless bundle so the reads work in production,
  // not just in local dev. Paths are relative to this app directory, so ../../
  // reaches the repo root.
  outputFileTracingIncludes: {
    // A glob, not a list: the log is one file per app plus platform.md, and
    // `@blackcode/platform-agent` discovers them by reading the directory.
    // Naming files here individually would mean a new app's changelog builds
    // locally and 500s in production, which is the failure only a real deploy
    // catches.
    '/api/changelog': ['../../docs/changelog/*.md'],
  },
  // `/agent-updater` is how anyone writing the link from memory spells it; the
  // page is `/agent-updator` in every app because apps/issues shipped it that
  // way and the X-BK-Help header must agree across apps. 307, not 308, so the
  // spelling stays reversible. Same rule as apps/issues/next.config.js.
  async redirects() {
    return [{ source: '/agent-updater', destination: '/agent-updator', permanent: false }]
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
      allowedOrigins: ['localhost:3001', 'sales.blackcode.ch'],
    },
  },
}

module.exports = nextConfig

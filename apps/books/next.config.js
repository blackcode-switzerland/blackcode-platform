const path = require('node:path')

// ── THE BRAND VARIABLES ARE INLINED AT BUILD TIME (ticket #756) ─────────────
// `lib/app.ts` reads these, and `lib/dictionary/index.ts` substitutes them into
// the dictionary that `lib/i18n.tsx` — a CLIENT module — imports. In a browser
// bundle `process.env.X` is `undefined` for anything not `NEXT_PUBLIC_`, so
// without this block a rebranded deployment renders its own name on the server
// and `b/books` in the browser. Listing them here makes Next inline the value
// into every bundle. Only SET variables are listed: an `undefined` under `env`
// is dropped by Next, and being explicit about that is cheaper than relying on
// it. The price is stated in `lib/app.ts`: a change needs a rebuild.
const BRAND_ENV = ['BOOKS_DISPLAY_NAME', 'BOOKS_CONTACT_EMAIL', 'BOOKS_PLATFORM_NAME']
const env = Object.fromEntries(
  BRAND_ENV.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])
)

/** @type {import('next').NextConfig} */
const nextConfig = {
  env,
  // Monorepo: this app lives at apps/books, but it reads and bundles files
  // from the repo root (docs/). Next must be told where the workspace root is,
  // or it infers it from the nearest lockfile and refuses to trace files above
  // the app.
  outputFileTracingRoot: path.join(__dirname, '../../'),

  // The platform packages ship TypeScript source, not a build step — Next
  // compiles them as part of this app. Adding a package to this app's
  // package.json is not enough; it must be listed here too, or the build fails
  // on `.ts` syntax.
  //
  // ── AND FOR `@blackcode/platform-ui`, THIS LINE IS ONLY HALF THE WIRING ────
  // `transpilePackages` makes the TypeScript compile. `@source` in
  // app/globals.css makes the CSS EXIST. Neither implies the other, and only
  // this one fails loudly — D-30, a live production bug in apps/issues for
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
  // Trace those files into the serverless bundle so the reads work in
  // production, not just in local dev. Paths are relative to this app directory,
  // so ../../ reaches the repo root.
  outputFileTracingIncludes: {
    // A glob, not a list: Phase 5 split the log into one file per app plus
    // platform.md, and lib/changelog.ts discovers them by reading the directory.
    // Naming files here individually would mean a new app's changelog builds
    // locally and 500s in production, which is the failure only a real deploy
    // catches.
    '/api/changelog': ['../../docs/changelog/*.md'],
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
      allowedOrigins: ['localhost:3200'],
    },
  },
}

module.exports = nextConfig

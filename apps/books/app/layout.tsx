// The root layout — and the ONE import in it that a copied app must not lose.
//
// `./globals.css` is what makes Tailwind run for this app at all, and it is
// where the `@source` line for the shared UI package lives (D-30). An app whose
// root layout does not reach a stylesheet has no Tailwind build, so
// `packages/platform-testing/test/ui-package-styling.test.ts` cannot see what it
// builds — and that check skips loudly rather than passing, because "no CSS
// found" and "CSS is correct" must not look the same.
import type { Metadata } from 'next'
import { Toaster } from 'sonner'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  // `b/<app> — <what it is>`, the same shape as the other two apps.
  title: 'b/books — Swiss statutory bookkeeping',
  description: 'Double-entry books that can be defended: every entry explained, every entry evidenced.',
  // `public/logo.png` — the same blackcode mark both other apps carry. Without
  // this the tab shows Next.js's default. The file is opaque (a white `b/` on
  // near-black, no alpha), so it reads in a light tab and a dark one alike.
  icons: { icon: '/logo.png' },
  // Internal tooling holding a company's own accounting records. Nothing here
  // should ever be indexed; `public/robots.txt` says the same thing to crawlers
  // that never read a meta tag.
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Google Sans is served by Google's CSS API but is not listed in the
          public Google Fonts directory, so `next/font/google` cannot fetch it.
          Linking the CSS API directly is the practical option; the preconnects
          keep the latency cost small. Same arrangement as the other two apps —
          the font is the platform's, the palette around it is this app's (D-B).
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&display=swap"
        />
      </head>
      <body className="font-sans antialiased">
        <Providers>
          {children}
          {/* Toasts are token-driven through the `--toast-*` bridge in
              globals.css, so this app's cream palette reaches them without a
              single colour being named here. */}
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: 'var(--toast-bg)',
                color: 'var(--toast-text)',
                border: '1px solid var(--toast-border)',
              },
            }}
          />
        </Providers>
      </body>
    </html>
  )
}

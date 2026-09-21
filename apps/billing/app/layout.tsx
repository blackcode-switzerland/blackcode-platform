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
import './globals.css'
import { APP_NAME } from '@/lib/app'
import { Providers } from './providers'

// READ FROM `APP_NAME`, NEVER A LITERAL.
//
// The scaffold has `title: 'Scaffold app'` here, and a copied literal is the
// first thing a rebranded deployment shows wrong: the browser tab is visible
// before anything else on the page renders. `APP_NAME` is environment-driven
// (lib/app.ts) precisely so the standalone copy in
// docs/billing-app-plan/standalone-deployment.md needs no edit here.
export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Swiss QR-bill invoicing',
  // `public/logo.png` — the same platform mark apps/books and apps/sales carry.
  icons: { icon: '/logo.png' },
  // Invoices name third parties and their bank details. Nothing here should
  // ever be indexed.
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Google Sans is served by Google's CSS API but is not in the public
            directory, so `next/font/google` cannot fetch it — same arrangement
            as apps/issues and apps/sales. The font is the platform's; the
            palette around it is this app's (globals.css). */}
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
          {/* Token-driven through the `--toast-*` bridge in globals.css; no
              colour is named here. */}
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

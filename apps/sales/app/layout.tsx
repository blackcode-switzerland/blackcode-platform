import type { Metadata } from 'next'
import { Toaster } from 'sonner'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  // `b/<app> — <what it is>`, the same shape as apps/issues. The name half comes
  // from the same place the sidebar and the email From line do (`lib/app.ts`);
  // it is spelled out here because `metadata` is a static export and cannot
  // interpolate a value a server component would have to compute.
  title: 'b/sales — business development pipeline',
  description: "blackcode's business-development pipeline",
  // `public/logo.png` — the same blackcode mark both apps carry. Without this the
  // tab shows Next.js's default, which is what it showed until 2026-08-11.
  //
  // The file is opaque (a white `b/` on near-black, no alpha), so it reads in a
  // light tab and a dark one alike. That is not incidental: a white-on-
  // transparent mark is invisible on exactly one of them, and half the readers
  // never see the half that is broken. The same file is what the email template
  // fetches as `${appUrl}/logo.png` — see `lib/email/send.ts`.
  icons: { icon: '/logo.png' },
  // Internal tooling holding third parties' contact details (D-19). Nothing here
  // should ever be indexed.
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
          keep the latency cost small. Same arrangement as apps/issues — the font
          is the platform's, the palette around it is this app's (D-4).
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
              globals.css, so sales' warm palette reaches them without a single
              colour being named here. */}
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

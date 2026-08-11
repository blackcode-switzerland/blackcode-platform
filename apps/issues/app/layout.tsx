import type { Metadata } from 'next'
import { Providers } from './providers'
import { Toaster } from 'sonner'
import { AgentManifest } from '@/components/agent-manifest'
import './globals.css'

export const metadata: Metadata = {
  // `b/<app> — <what it is>`, the same shape as apps/sales. Static export, so
  // the name is spelled rather than read from `lib/app.ts` — see the note there.
  title: 'b/issues — AI-native issue tracking',
  // "Three surfaces (web, CLI, HTTP)" until 2026-08-11. The HTTP API is private
  // plumbing with no public contract (CLAUDE.md, agent surface contract) — the
  // OpenAPI spec is a 410 and there is no third door. Two.
  description: 'Issue tracking for humans and the agents working alongside them. A web UI and a CLI over one data model.',
  icons: {
    icon: '/logo.png',
  },
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Google Sans is served by Google's CSS API but is not listed in the
          public Google Fonts directory, so next/font/google can't fetch it.
          Linking the CSS API directly is the practical option; preconnect
          hints keep the latency cost minimal.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&display=swap"
        />
      </head>
      <body className="font-sans antialiased">
        {/* Machine-readable access note for agents fetching any page. Renders nothing visible. */}
        <AgentManifest />
        <Providers>
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: 'var(--toast-bg)',
                color: 'var(--toast-text)',
                border: '1px solid var(--toast-border)',
              },
              classNames: {
                success:
                  '!border-green-600/30 !bg-green-50 !text-green-800 dark:!border-green-600/40 dark:!bg-green-950/60 dark:!text-green-300',
                error:
                  '!border-red-600/30 !bg-red-50 !text-red-700 dark:!border-red-600/40 dark:!bg-red-950/60 dark:!text-red-300',
              },
            }}
          />
        </Providers>
      </body>
    </html>
  )
}

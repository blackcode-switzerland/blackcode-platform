'use client'

// SessionProvider → QueryClientProvider → ThemeProvider → ConfirmProvider,
// the order apps/sales settled on. The session is outermost because the shell's
// account footer reads it; the confirm dialog renders portal content that must
// sit inside the theme class or it paints with the wrong palette.
//
// `ConfirmProvider` is the ONLY confirmation mechanism this repo allows — never
// `window.confirm` / `window.prompt` (voiding an invoice collects its reason
// through `useConfirm`'s prompt variant).

import { SessionProvider } from 'next-auth/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useState } from 'react'
import { ConfirmProvider } from '@blackcode/platform-ui/ui/confirm-dialog'
import { WebError } from '@/lib/client'

export function Providers({ children }: { children: React.ReactNode }) {
  // Inside state, not module scope: a module-scope client is shared across
  // every request in a server process and leaks one user's cache into another's.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // An agent writes invoices in the background, so a page left open
            // goes stale on its own schedule. Same settings as sales.
            staleTime: 1000 * 30,
            refetchOnWindowFocus: true,
            // A 4xx is an answer (not found, refused), not a flake: retrying it
            // only delays the error the page must show.
            retry: (count, error) =>
              !(error instanceof WebError && error.status >= 400 && error.status < 500) && count < 2,
          },
        },
      })
  )

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SessionProvider>
  )
}

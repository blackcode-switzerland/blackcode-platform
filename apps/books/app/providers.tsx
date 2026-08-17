'use client'

// The provider stack, in the order `apps/sales/app/providers.tsx` specifies:
//
//   SessionProvider → QueryClientProvider → ThemeProvider → ConfirmProvider
//
// The order is not decorative. `useSession` is read inside the shell's account
// footer and is available to query functions, so the session has to be
// outermost; the confirm dialog renders portal content that must sit inside the
// theme class or it paints with the wrong palette.
//
// `ConfirmProvider` is here even though this sprint renders no destructive
// action, and that is deliberate: `useConfirm()` is the ONLY confirmation
// mechanism this repo allows (never `window.confirm`), and a provider added
// later is a provider some component will have been written without.
//
// ===========================================================================
// WHY B/BOOKS' `staleTime` IS LONGER THAN SALES'
// ===========================================================================
// Sales uses 30s because an agent is writing its records in the background and
// a page left open should catch up on its own schedule. b/books is the same
// shape — agents drive it through `bk books` from outside — but the DATA is
// different in one way that matters: a posted entry is immutable and an exercice
// that has been closed cannot change at all. Refetching a balance sheet every
// thirty seconds asks the server to re-derive a statement that provably did not
// move.
//
// Two minutes, and still a refetch on window focus, which is the case that
// actually matters: you ran `bk books` in a terminal and came back to the tab.
//
// **This is not the staleness that could hurt.** The dangerous cache in this app
// is showing one book's numbers under another book's name, and no `staleTime`
// prevents that — the QUERY KEY does. See `lib/query-keys.ts`.

import { SessionProvider } from 'next-auth/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useState } from 'react'
import { ConfirmProvider } from '@blackcode/platform-ui/ui/confirm-dialog'

export function Providers({ children }: { children: React.ReactNode }) {
  // Created inside state, not at module scope. A module-scope client is shared
  // across every request in a server process, which leaks one user's cache into
  // another's response.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 120,
            refetchOnWindowFocus: true,
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

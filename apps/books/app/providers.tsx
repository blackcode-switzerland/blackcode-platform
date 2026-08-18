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

//
// ===========================================================================
// A 4xx IS AN ANSWER. IT IS NOT RETRIED — ADDED 2026-08-18
// ===========================================================================
// TanStack's default is three retries with backoff, which is right for a network
// blip and wrong for every refusal this API serves deliberately. The one that
// forced the change: `GET …/bilan` returns **400 `no_bilan_for_simplified`** for
// the sole proprietorship, and that is a first-class screen state — "this book
// legally has no balance sheet, here is its patrimoine" — not a failure. Under
// the default it was requested four times over about four seconds before the
// explanation rendered, so the correct screen arrived looking like a slow error.
//
// It also mattered for the book switcher: four in-flight retries against the
// PREVIOUS book are four chances for a late response to land after the switch.
// The query key is what makes that safe (`lib/query-keys.ts`), but not asking is
// better than being protected from having asked.
//
// 408 and 429 are retried, because those two genuinely mean "ask again".

import { SessionProvider } from 'next-auth/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useState } from 'react'
import { ConfirmProvider } from '@blackcode/platform-ui/ui/confirm-dialog'
import { ApiRequestError } from '@/lib/client'

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
            retry: (failureCount, error) => {
              if (error instanceof ApiRequestError) {
                const retryable = error.status === 408 || error.status === 429
                if (error.status >= 400 && error.status < 500 && !retryable) return false
              }
              return failureCount < 3
            },
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

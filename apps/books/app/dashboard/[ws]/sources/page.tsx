'use client'

// Accounts & sources — the nav item routes, the screen is sprint 2.
//
// ── THIS ONE IS NOT ENTITY-SCOPED, AND SO IT DOES NOT USE `<ScreenFrame>` ───
// `lib/nav.ts` marks it `scoped: false`: a bank, a card, a processor or a
// document feed is a channel money arrives through, and one channel can feed
// more than one book. The top bar hides the book switcher here for that reason.
//
// So this page must NOT refuse an unknown `?entity=` the way the scoped screens
// do — the parameter is simply not part of its question, and it survives in the
// URL only so that navigating away keeps the reader's book. Rendering
// "there is no book called typo" on a page whose content does not depend on the
// book would be a refusal the reader cannot act on.

import { useScope } from '@/lib/scope'
import { ErrorState, FixtureNotice, Loading, NotBuiltYet } from '@/components/states'
import { NoBooks } from '@/components/no-books'

export default function Page() {
  const { isLoading, error, entities, source } = useScope()

  if (isLoading) return <Loading rows={5} label="Loading accounts & sources" />
  if (error) return <ErrorState error={error} title="Accounts & sources could not be loaded" />
  // A register of the channels money arrives through is meaningless with no
  // books to post into, so zero books lands on the same screen as everywhere
  // else rather than on an empty register.
  if (entities.length === 0) return <NoBooks />

  return (
    <div className="mx-auto max-w-4xl">
      <FixtureNotice source={source} />
      <NotBuiltYet screen="Accounts & sources" mockup="app-sources.html" />
    </div>
  )
}

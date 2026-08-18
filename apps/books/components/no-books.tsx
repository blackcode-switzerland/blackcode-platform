'use client'

// The screen a new employee gets: an account, and no books in it.
//
// ===========================================================================
// THE MOCKUP HAS NO EMPTY STATE BECAUSE ITS AUTHOR ALWAYS HAD THREE BOOKS
// ===========================================================================
// Decision D-D: b/books is a generic internal tool, not one person's app. Any
// employee, one book or many. Andrea's three are seed data for one workspace,
// not the product. So zero is a real, ordinary, first-day state and it gets a
// designed screen rather than a blank page — and nothing anywhere may assume
// there are three books or hardcode a slug.
//
// ===========================================================================
// IT DOES NOT OFFER A BUTTON, AND THE REASON IS NOT "WE RAN OUT OF TIME"
// ===========================================================================
// b/books' web surface is read-mostly by design: thirteen screens, four writes,
// none of which is "create a book". Creating one is a setup act with legal
// consequences — a legal form, a seat that decides which cantonal tax parameters
// apply, an audit status, a VAT registration — and it is not a thing to do in a
// modal with four fields.
//
// **And today it cannot be done at all, from any surface.** `books.entity` does
// not exist yet: `/api/meta` serves the seeded books from `fixtures/mockup.json`
// with `source: "fixture"`, and the table arrives with the backend's phase 1. So
// this screen names no command, links to no form, and does not tell anybody to
// run something that would fail. That is deliberate — a page offering a recovery
// which does not exist is worse than one offering none, and the same rule keeps
// `bk books` off `<NotBuiltYet>`.
//
// **The copy below is provisional and the report says so.** `01-foundation.md`
// §5 asks for wording agreed with the backend dev; this is what can be said
// truthfully before that conversation, not the outcome of it.

import { BookOpen } from 'lucide-react'

export function NoBooks({ email }: { email?: string | null }) {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <span className="inline-flex size-11 items-center justify-center rounded-lg bg-primary/15 text-primary-strong">
        <BookOpen size={20} />
      </span>
      <h1 className="mt-4 text-lg font-semibold text-foreground">You have no books yet</h1>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        A book is one legal entity&rsquo;s complete set of accounts — a company, or a
        self-employment activity. It has its own chart of accounts, its own fiscal year and its own
        balance sheet, and it never mixes with another one.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        You can have as many as you need. Everything else in b/books — the ledger, the statements,
        the recognition queue — is scoped to whichever one you are looking at.
      </p>

      <div className="mt-7 rounded-lg border border-border bg-card px-5 py-4 text-left">
        <p className="text-sm font-medium text-foreground">Setting one up</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Opening a set of books is a setup step, not something this app does from a form: it needs
          the legal form, the registered seat — which decides the cantonal and communal tax
          parameters — the bookkeeping regime, and the VAT position. Ask whoever set up your
          account.
        </p>
      </div>

      {email && (
        <p className="mt-6 text-xs text-muted-foreground">
          Signed in as {email}. Your blackcode account works across every blackcode app.
        </p>
      )}
    </div>
  )
}

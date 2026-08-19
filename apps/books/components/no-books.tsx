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
// IT NAMES THE COMMAND NOW. IT USED TO SAY "ASK WHOEVER SET UP YOUR ACCOUNT"
// ===========================================================================
// **That sentence was correct when it was written and wrong by the time anybody
// read it**, which makes it the clearest example this app has of the failure
// mode its own handover notes warn about five times over: a screen that was
// true, green and tested, describing a backend that has since moved.
//
// On 2026-08-17 `books.entity` did not exist. `/api/meta` served the seeded
// books out of `fixtures/mockup.json` marked `source: "fixture"`, there was no
// create route, and no surface anywhere could open a set of books. Naming a
// command that would fail is worse than naming none, so this screen named none
// and said to ask an administrator.
//
// The table landed, `POST /api/workspaces/{ws}/entities` landed, and
// `bk books entity create` landed with it — and the screen kept apologising.
// The first person to sign up for their own account read "ask whoever set up
// your account", having just set it up themselves, and reasonably concluded the
// app would not let them add a book. Found by a human using it, 2026-08-19.
//
// ── THERE IS STILL NO BUTTON, AND THAT PART IS A DECISION ──────────────────
// b/books' web surface is read-mostly by design: thirteen screens, five writes,
// none of which is "create a book". Opening a set of books is a setup act with
// legal consequences — the legal form fixes the bookkeeping regime for the life
// of the entity (art. 957 CO), and the registered seat decides which cantonal
// and communal tax parameters every later figure is computed with. It is not a
// thing to do in a modal with four fields and no way back: `books.entity` has no
// delete, for the same ten-year-retention reason nothing else here does.
//
// So it is a CLI act, deliberately, and this screen says which command, with the
// three things it needs. That is the platform rule applied rather than dodged —
// a capability that exists in only one front door is allowed to, provided
// somebody decided it and wrote it down.

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
        <p className="text-sm font-medium text-foreground">Opening one</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          From a terminal, with the <code className="rounded bg-secondary px-1 py-0.5">bk</code>{' '}
          CLI. It is not a form in this app on purpose: the legal form fixes which bookkeeping
          rules the entity is kept under for its whole life, and the registered seat decides the
          cantonal and communal tax parameters every later figure is computed with. Neither can be
          changed afterwards by editing a field.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md bg-secondary px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground">
{`bk books entity create \\
  --slug blackcode \\
  --name "blackcode SA" \\
  --legal-form SA`}
        </pre>
        <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">SA</span> for a capital company, which is
          always double-entry, or <span className="font-medium text-foreground">RI</span> for a sole
          proprietorship, which is kept simplified unless you say otherwise. The book arrives with
          the Swiss PME chart of accounts already in it. Then open its first fiscal year with{' '}
          <code className="rounded bg-secondary px-1 py-0.5">bk books exercice create</code> —
          nothing can be posted until there is one.
        </p>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        No <code className="rounded bg-secondary px-1 py-0.5">bk</code> yet? Run{' '}
        <code className="rounded bg-secondary px-1 py-0.5">bk login</code> once and it will bring
        you back here to authorize it.
      </p>

      {email && (
        <p className="mt-6 text-xs text-muted-foreground">
          Signed in as {email}. Your blackcode account works across every blackcode app.
        </p>
      )}
    </div>
  )
}

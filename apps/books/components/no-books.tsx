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
import { useT } from '@/lib/i18n'

export function NoBooks({ email }: { email?: string | null }) {
  const t = useT()
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <span className="inline-flex size-11 items-center justify-center rounded-lg bg-primary/15 text-primary-strong">
        <BookOpen size={20} />
      </span>
      <h1 className="mt-4 text-lg font-semibold text-foreground">{t('noBooks.title')}</h1>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t('noBooks.p1')}</p>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t('noBooks.p2')}</p>

      <div className="mt-7 rounded-lg border border-border bg-card px-5 py-4 text-left">
        <p className="text-sm font-medium text-foreground">{t('noBooks.openingOne')}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {t('noBooks.openingBody', { bk: 'bk' })}
        </p>
        {/* The command itself is NOT in the dictionary and never will be. It is
            a spelling the binary accepts, not prose: translating `--legal-form`
            would produce a French sentence containing a flag that does not
            exist. `lib/hardcoded-strings.test.ts` allows a `<pre>` for exactly
            this, and its header says so. */}
        <pre className="mt-3 overflow-x-auto rounded-md bg-secondary px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground">
{`bk books entity create \\
  --slug blackcode \\
  --name "blackcode SA" \\
  --legal-form SA`}
        </pre>
        <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
          {t('noBooks.formsBody', {
            sa: 'SA',
            ri: 'RI',
            exercice: 'bk books exercice create',
          })}
        </p>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        {t('noBooks.noCli', { bk: 'bk', login: 'bk login' })}
      </p>

      {email && (
        <p className="mt-6 text-xs text-muted-foreground">
          {t('noBooks.signedInAs', { email })}
        </p>
      )}
    </div>
  )
}

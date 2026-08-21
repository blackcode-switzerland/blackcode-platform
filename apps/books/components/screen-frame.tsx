'use client'

// The four things every entity-scoped screen has to handle before it can render
// anything, in one place.
//
//   loading        `/api/meta` has not answered — a skeleton, never a blank
//   error          it failed — the server's message and its `suggestion`
//   no books       an account with none. Not an error; see `<NoBooks>`
//   unknown book   `?entity=typo`. The URL asked for a book that is not served
//
// The last one is the reason this is shared. `lib/scope.ts` deliberately does
// NOT fall back to the first book when the slug is unknown, because showing one
// book's numbers under another's name is this app's worst failure mode. That
// decision only pays off if every screen renders the refusal — and thirteen
// screens each writing their own is thirteen chances for one to render the
// default book instead.
//
// A screen wraps its body in this and can then assume `record` is a real book.

import { useScope } from '@/lib/scope'
import { useT } from '@/lib/i18n'
import { ErrorState, FixtureNotice, Loading } from './states'
import { NoBooks } from './no-books'
import { PageShell } from './section'

export function ScreenFrame({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  const { isLoading, error, entities, entity, record, source } = useScope()
  const t = useT()

  // ── EVERY BRANCH IS PADDED, AND THAT USED TO BE SOMEBODY ELSE'S JOB ──────
  // The page padding moved out of `<BooksShell>`'s `<main>` on 2026-08-21, so
  // an early return that is not wrapped renders flush against the sidebar and
  // the top bar. These four are the states a reader is MOST likely to be in on
  // a bad day — the request failed, the book does not exist, there are no books
  // at all — which makes them the worst four to let render broken.
  if (isLoading)
    return (
      <PageShell>
        <Loading rows={5} label={t('state.loadingThing', { thing: title })} />
      </PageShell>
    )
  if (error)
    return (
      <PageShell>
        <ErrorState error={error} title={t('state.errorTitleThing', { thing: title })} />
      </PageShell>
    )
  if (entities.length === 0)
    return (
      <PageShell>
        <NoBooks />
      </PageShell>
    )

  if (record === null) {
    return (
      <PageShell>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3.5" role="alert">
          <p className="text-sm font-medium text-foreground">
            {t('frame.noSuchBookTitle', { slug: entity ?? '' })}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{t('frame.noSuchBookBody')}</p>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <FixtureNotice source={source} />
      {children}
    </PageShell>
  )
}

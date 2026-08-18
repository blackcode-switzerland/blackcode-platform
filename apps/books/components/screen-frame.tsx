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
import { ErrorState, FixtureNotice, Loading } from './states'
import { NoBooks } from './no-books'

export function ScreenFrame({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  const { isLoading, error, entities, entity, record, source } = useScope()

  if (isLoading) return <Loading rows={5} label={`Loading ${title}`} />
  if (error) return <ErrorState error={error} title={`${title} could not be loaded`} />
  if (entities.length === 0) return <NoBooks />

  if (record === null) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3.5" role="alert">
        <p className="text-sm font-medium text-foreground">
          There is no book called <span className="font-mono">{entity}</span>.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          The address bar is asking for a book this account does not have. Pick one from the control
          in the top bar.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      <FixtureNotice source={source} />
      {children}
    </div>
  )
}

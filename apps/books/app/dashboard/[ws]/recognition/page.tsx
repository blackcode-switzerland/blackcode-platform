'use client'

// Recognition — the legibility layer, and the only screen in b/books with
// judgment in it.
//
// ===========================================================================
// EVERY OTHER SCREEN READS. THIS ONE CHANGES A COMPANY'S BOOKS.
// ===========================================================================
// Raw bank noise in, explained meaning out. What the system cannot yet explain
// waits here until a human (or an agent a human runs) says what it was — and
// each resolution can teach a rule, so the next matching payment explains
// itself. That loop is the product.
//
// ── THE COUNT HERE IS THE COUNT THE OVERVIEW SHOWS ────────────────────────
// It is taken from the payload's own `count`, not from `rows.length`, so the
// two cannot drift through a render. The overview computes the same figure with
// a DIFFERENT predicate — it counts one table, chosen by the book's regime,
// where this route counts both — and they agree on every book that has rows in
// one table only, which is every book that exists. `lib/hooks.ts` records it as
// a backend request rather than papering over it here.
//
// ── WHAT THE SERVER CHOSE IS SHOWN, NOT WHAT WE ASKED FOR ─────────────────
// The payload echoes `entity` and `exercice`. A request whose `?entity=` was
// dropped is answered with the FIRST book in the workspace, and the only way to
// notice is to compare. So the subtitle names the book the SERVER answered for.
//
// ── THE «ÉTAT BRUT» PANEL IS NOT BUILT, DELIBERATELY ──────────────────────
// The mockup ends with a "raw record (agent surface)" JSON dump. Andrea dropped
// that screen on 2026-08-18 (DECISIONS.md): agents use `bk`, and a page that is
// also an API is two contracts for one fact. `bk books worklist --json` is the
// agent surface and it is the one that stays true.

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useScope } from '@/lib/scope'
import { useRules, useWorklist } from '@/lib/hooks'
import { ScreenFrame } from '@/components/screen-frame'
import { ErrorState, Loading } from '@/components/states'
import { NoExerciceNotice, isNoExerciceRefusal } from '@/components/no-exercice-notice'
import { Worklist, type ResolvedMap } from '@/components/worklist'
import { RulesPanel } from '@/components/rules-panel'
import type { ResolveResult, WorklistRow } from '@/lib/types'

export default function Page() {
  const params = useParams<{ ws: string }>()
  const scope = useScope()
  const base = `/dashboard/${params.ws}`

  const worklist = useWorklist(params.ws, scope)
  const rules = useRules(params.ws, scope)

  /**
   * Rows resolved in this session, keyed `kind:number`.
   *
   * The route serves only `unrecognized` and `inferred`, so a resolved row
   * leaves the payload the moment the list refetches — the count shrinks, which
   * is correct. But "a resolved row still shows: was unrecognized" is the
   * product's audit claim, so what the server RETURNED is kept here and the row
   * is re-inserted below in its resolved form. It is a session memory, not a
   * cache: a reload clears it, and the permanent record is `history` on the
   * entry itself.
   */
  const [resolved, setResolved] = useState<ResolvedMap>({})
  /** The rows as they were when they were resolved, to keep drawing them. */
  const [resolvedRows, setResolvedRows] = useState<WorklistRow[]>([])

  function onResolved(row: WorklistRow, result: ResolveResult) {
    setResolved((prev) => ({ ...prev, [`${row.kind}:${row.number}`]: result }))
    setResolvedRows((prev) =>
      prev.some((r) => r.kind === row.kind && r.number === row.number) ? prev : [...prev, row]
    )
  }

  /**
   * The live list, plus the rows this session resolved that have since left it.
   *
   * A row that is still in the payload is NOT duplicated: the resolve may have
   * failed to remove it (a refetch that has not landed, or a row that stayed
   * unrecognized because something else changed it), and in that case the live
   * row is the truth and the local memory decorates it.
   */
  const rows = useMemo(() => {
    const live = worklist.data?.rows ?? []
    const seen = new Set(live.map((r) => `${r.kind}:${r.number}`))
    return [...live, ...resolvedRows.filter((r) => !seen.has(`${r.kind}:${r.number}`))]
  }, [worklist.data, resolvedRows])

  /**
   * The name of the book the worklist payload says it answered for.
   *
   * Falls back to the URL's book only while the payload is in flight, and to an
   * em dash only when there is neither — which is a state `<ScreenFrame>` holds
   * a skeleton over.
   */
  const answeredBook =
    (worklist.data
      ? (scope.entities.find((e) => e.slug === worklist.data!.entity)?.name ?? worklist.data.entity)
      : scope.record?.name) ?? '—'

  return (
    <ScreenFrame title="Recognition">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-foreground">Recognition</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {/* ── THE BOOK THE SERVER ANSWERED FOR, RESOLVED TO ITS NAME ───────
              Reading `worklist.data.entity` rather than the URL is right and is
              kept: it is the only way to see that a request whose `?entity=`
              was dropped came back answered for a DIFFERENT book.

              But this slot held `worklist.data?.entity ?? scope.record?.name`
              until 2026-08-18, and those are two different KINDS of string — a
              slug (`blackcode`) and a company name (`blackcode SA`). The
              comment here claimed the two were "distinguishable because this
              line changes if they differ", and they are not: the line changes
              on EVERY load, because the fallback renders while the payload is
              in flight and then the slug replaces it. A real disagreement and
              an ordinary first paint looked identical, which is the same defect
              as a check that cannot tell a denial from an absent subject.

              Resolving the slug through the book list fixes both halves: the
              slot always holds a name, so a server that answered for another
              book now reads as another COMPANY, which is a thing a reader
              notices. The raw slug is kept when it resolves to nothing — a book
              the list does not have is worth showing exactly as it arrived
              rather than replaced by an em dash. */}
          {answeredBook} · exercice {worklist.data?.exercice ?? scope.exercice ?? '—'}
        </p>
        <p className="mt-2 max-w-2xl text-[12.5px] text-muted-foreground">
          Money that moved without an agreed meaning waits here. Explaining a row is the whole
          product — and every explanation can teach a rule, so the next payment like it explains
          itself.
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-foreground">
          To explain
          {/* The payload's own count. Not `rows.length`, which now includes the
              rows this session resolved and would therefore never shrink. */}
          {worklist.data && (
            <span className="ml-2 text-[13px] font-normal text-muted-foreground">
              {worklist.data.count}
            </span>
          )}
        </h2>
      </div>

      {worklist.isLoading && <Loading rows={4} label="Loading the worklist" />}

      {/* ── A BOOK WITH NO FISCAL YEAR IS NOT A FAILED WORKLIST ────────────
          `<NoExerciceNotice>`'s own header says the statement screens were the
          sibling that got this right and calls out that the case "was handled
          and this sibling was missed". Recognition was the next one missed.

          Reproduced 2026-08-18: `bk books entity create --slug noyear` and then
          this screen, on a brand-new book in perfect order, rendered TWO red
          `role="alert"` boxes — "The worklist could not be loaded" and, from
          `<RulesPanel>`, "This could not be loaded" — each printing the server's
          machine code `bad_scope` to the reader. Every book starts in this
          state, so this is the FIRST screen a new book shows and it said the app
          was broken.

          Checked before the generic error, for the reason the balance sheet
          gives: ordering these the other way round puts a red box on a book
          whose books are in perfect order. */}
      {isNoExerciceRefusal(worklist.error) && (
        <NoExerciceNotice error={worklist.error} statement="worklist" bookName={answeredBook} />
      )}
      {worklist.error && !isNoExerciceRefusal(worklist.error) && (
        <ErrorState error={worklist.error} title="The worklist could not be loaded" />
      )}
      {worklist.data && (
        <Worklist
          ws={params.ws}
          scope={scope}
          base={base}
          rows={rows}
          rules={rules.data}
          resolved={resolved}
          onResolved={onResolved}
        />
      )}

      <p className="mt-2 text-[11.5px] text-muted-foreground">
        An unrecognized entry does not post blind. An inferred one carries something’s best guess
        and is waiting for a person to agree with it.
      </p>

      {/* The rules panel is suppressed under the same refusal rather than shown
          with its own red box: a book with no fiscal year has no rules to list
          and no entry to teach one from, so the panel would offer "Add a rule"
          against a scope the server refuses. One explanation above, not two
          errors. */}
      {!isNoExerciceRefusal(worklist.error) && (
        <RulesPanel
          ws={params.ws}
          scope={scope}
          base={base}
          rules={rules.data}
          isLoading={rules.isLoading}
          error={rules.error}
        />
      )}
    </ScreenFrame>
  )
}

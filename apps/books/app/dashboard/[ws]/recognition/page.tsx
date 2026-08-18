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

  return (
    <ScreenFrame title="Recognition">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-foreground">Recognition</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {/* The book the SERVER answered for, once it has answered. Before that
              it is the book the URL asked for — and the two are distinguishable
              because this line changes if they differ. */}
          {worklist.data?.entity ?? scope.record?.name ?? '—'} · exercice{' '}
          {worklist.data?.exercice ?? scope.exercice ?? '—'}
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
      {worklist.error && (
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

      <RulesPanel
        ws={params.ws}
        scope={scope}
        base={base}
        rules={rules.data}
        isLoading={rules.isLoading}
        error={rules.error}
      />
    </ScreenFrame>
  )
}

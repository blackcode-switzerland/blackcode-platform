'use client'

// The transition into the immutable record. The deepest write in this product.
//
// ===========================================================================
// EVERY OTHER WRITE THIS APP MAKES IS REVISABLE. THIS ONE IS NOT.
// ===========================================================================
// The onion the backend sent settles what this screen owes the reader: writes
// get harder as they travel inward. Resolve, teach a rule and match a pièce all
// land in ring 2 — rules and meaning, the only ring that takes free rewrites,
// each one appending its old state to `history`. Nothing they touch is a
// balance and nothing they do cannot be said differently tomorrow.
//
// Posting moves a line into RING 0. From here on **nobody, human or agent, can
// modify or delete it** — migration 0004's triggers see to that — and a
// correction is a new reversing entry beside the old one rather than a change
// to it. There is no undo, there is no "unpost", and there is not meant to be.
//
// ===========================================================================
// SO THE TARGET IS REPEATED BACK, AND `useConfirm()` IS NOT ENOUGH
// ===========================================================================
// The house pattern for something irreversible is `bk workspace delete <slug>
// --confirm <slug>` — the caller names the thing again. CLAUDE.md's reason is
// about agents: `Confirm()` auto-approves under `BK_NO_PROMPT=1` and on a
// non-TTY, "exactly how agents run". The same argument holds for a person: a
// dialog with a highlighted button is answered by reflex, and a reflex is what
// this write must not be reachable by.
//
// So the reader types the entry's #number. Not "POST", not "yes" — the NUMBER,
// because it is the one string that is different for every entry and therefore
// the only one that cannot be typed without looking at which entry this is. A
// person who mistypes it gets a form that will not submit, which is the correct
// outcome; a person who typed the number of the entry they meant to post is on
// the wrong page and finds out here rather than afterwards.
//
// ===========================================================================
// `already: true` IS AN OUTCOME, NOT A FAILURE
// ===========================================================================
// The route is idempotent on purpose: *"posting a posted entry reports
// `already: true` rather than refusing, because the Companion retries and a
// retry is not an error."* Drawn as an error it would tell a person their books
// are broken when what happened is that a robot pressed the same button twice.
//
// It is tested with `typeof === 'boolean'` and read POSITIVELY (`already ===
// true`), never as truthiness of a field that might be missing. `undefined` is
// falsy, so a payload that lost the field would render a re-post as a fresh
// post — which is F-2's `undefined !== null` exactly, one field over.
//
// ===========================================================================
// THE 0004 GUARD HAS THE LAST WORD — AND ITS WORDS DO NOT REACH THIS SCREEN
// ===========================================================================
// `postEntry` checks for unmapped lines BEFORE it writes, and that refusal
// arrives intact: `unresolved_lines`, 400, with its own suggestion. The DATABASE
// then checks balance, at least two lines, and every line mapped, AT COMMIT, as
// a deferred constraint — so a second refusal can arrive after the update
// statement has already succeeded. The route means to translate that into
// `guard_refused` and this form means to print it verbatim.
//
// **`guard_refused` has never fired, and cannot.** Verified 2026-08-19 by
// building the case rather than by reading the code: a declared entry, its two
// lines MAPPED (so the pre-check passes) and deliberately unbalanced (77.00
// against 99.00), posted from this form.
//
//   in the browser   500, `internal_error`, "Internal server error"
//   `bk books entry post 19`   error: Internal server error (500), exit 1
//   the same statements in psql   ERROR: entry 1272 does not balance:
//                                 debit 77.00 <> credit 99.00
//
// The guard works perfectly. The route's `catch` reads `e.message`, and under
// drizzle-orm 0.45 a failure raised at COMMIT is wrapped in a
// `DrizzleQueryError` whose message is `Failed query: COMMIT\nparams:` — the
// database's sentence is on `e.cause`. So `/does not balance|cannot be posted/`
// tests the wrapper, never matches, and every 0004 refusal falls through to a
// 500 on BOTH surfaces. **A translation branch that has never been watched fire
// is not a translation branch** — CLAUDE.md's standing rule, on the backend side
// of the wire. It is a route, so it is theirs, and the report asks for it.
//
// Until it lands, this form prints what it was given and SAYS the database's
// words were lost, rather than inventing them. A paraphrase would be this app
// restating a constraint that encodes art. 957a CO, and the whole claim of the
// product is that its records are defensible on the terms the law actually sets.
//
// ── THE SUBSTITUTION IS DELIBERATELY NARROW, AND RETIRES ITSELF ──────────
// It fires on a 500 from THIS route and nothing else. The day the route
// translates the error, the refusal arrives as a 400 with the guard's own
// sentence, this branch stops firing, and there is nothing to remove. Same shape
// and same reasoning as `refusalText` in `<MatchPieceForm>`, which exists for
// the match route's 404 discarding its own message. Two of these now; that is a
// pattern rather than a one-off, and the report says so.

import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { useCanWrite, usePostEntry, type PostResult } from '@/lib/mutations'
import { booksCacheFilter } from '@/lib/query-keys'
import type { Entry } from '@/lib/types'

export function PostEntryForm({
  ws,
  entry,
  onPosted,
}: {
  ws: string | undefined
  /** The entry as the route served it. Rendered from, and repeated back. */
  entry: Entry
  /** Called with what the server actually returned, so the page can show it. */
  onPosted: (result: PostResult) => void
}) {
  const canWrite = useCanWrite()
  const post = usePostEntry(ws, entry.number)
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  // The STATUS is kept beside the code, because the case this form cannot
  // otherwise recognise is a 500 whose code is the generic `internal_error` —
  // see the header. A code alone would not distinguish it from anything else
  // that could ever be spelled that way.
  const [refusal, setRefusal] = useState<{ message: string; code: string; status: number } | null>(
    null
  )
  // ── IN FLIGHT, SYNCHRONOUSLY ─────────────────────────────────────────────
  // `disabled={post.pending}` is React STATE and the attribute does not exist
  // until the next render, so two clicks in one tick both go through. On the
  // resolve form that shipped two POSTs 20ms apart and taught two rules (F-1 of
  // the phase-2 review). Here the second POST would answer `already: true`
  // rather than doing damage — the route is idempotent — but the screen would
  // then report a re-post for a post the reader made once, which is a false
  // statement about the audit trail on the one write that cannot be undone.
  const inFlight = useRef(false)

  // ── THE AFFORDANCE ITSELF IS GATED ──────────────────────────────────────
  // Not just what it opens. A button that renders and then explains it cannot
  // do anything teaches the reader the app is broken rather than that they lack
  // a permission. Phase 2 learned this on the resolve button.
  if (!canWrite) {
    return (
      <p className="mt-2 text-[12px] text-muted-foreground">
        This session cannot change records, so this entry cannot be posted here.
      </p>
    )
  }

  const target = String(entry.number)
  const matches = confirm.trim() === target

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-foreground hover:border-primary"
      >
        Post this entry
      </button>
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (inFlight.current) return
    // The typed number is checked here as well as on the button's `disabled`,
    // for the same reason the ref exists: `disabled` is a rendering and this is
    // the thing that holds. A form submitted by Enter before the attribute
    // caught up would otherwise post an entry nobody named.
    if (!matches) return

    inFlight.current = true
    setRefusal(null)
    try {
      const result = await post.run()
      if (!result.ok) {
        // THE SERVER'S OWN SENTENCE. On `guard_refused` that sentence is the
        // DATABASE's, translated by the route out of Postgres's phrasing and
        // otherwise unedited — see the header.
        setRefusal({
          message: result.message,
          code: result.error.code,
          status: result.error.status,
        })
        return
      }
      // The whole cache root. Posting moves an amount from "excluded from every
      // figure" to "counted in the bilan and the compte de résultat", so it
      // changes both statements, the ledger's status column, the overview's
      // staged count and the entry itself. Enumerating that is a list that goes
      // stale; see `booksCacheFilter`.
      await queryClient.invalidateQueries(booksCacheFilter())
      setOpen(false)
      setConfirm('')
      onPosted(result.data)
    } finally {
      inFlight.current = false
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-2.5 rounded-md border border-destructive/30 bg-destructive/5 p-3"
      data-post-form={entry.number}
    >
      <p className="flex items-start gap-1.5 text-[12.5px] font-medium text-foreground">
        <Lock size={13} className="mt-0.5 shrink-0" />
        <span>This cannot be undone.</span>
      </p>

      {/* ── WHAT BECOMES IMMUTABLE, IN THE READER'S WORDS ─────────────────
          Not "this action is irreversible". The reader is about to change what
          the law lets them do with this record for the next ten years, and the
          specific things that stop being possible are what they need in order
          to decide. */}
      <ul className="mt-1.5 space-y-1 text-[12px] text-muted-foreground">
        <li>
          The <span className="text-foreground">date, the amounts and the accounts</span> of this
          entry are fixed from now on. Nobody can change them — not you, not an agent, not the
          database owner. A correction becomes a new reversing entry sitting beside this one.
        </li>
        <li>
          <span className="text-foreground">What it means can still be revised.</span> The
          explanation, the counterparty, the recognition state and the supporting document stay
          open, and each revision keeps what was there before.
        </li>
        <li>
          It <span className="text-foreground">starts counting</span> in the balance sheet and the
          income statement. Staged entries are excluded from both.
        </li>
      </ul>

      {/* The entry, restated, so the number below is typed against something
          visible rather than remembered. */}
      <p className="mt-2.5 text-[12px] text-muted-foreground">
        Posting <span className="font-mono text-foreground">#{entry.number}</span> — journal n°{' '}
        <span className="font-mono text-foreground">{entry.entry_no}</span> —{' '}
        <span className="text-foreground">{entry.raw_label}</span>
      </p>

      <label
        htmlFor={`post-confirm-${entry.number}`}
        className="mt-2.5 block text-[11.5px] font-medium uppercase tracking-wider text-muted-foreground"
      >
        Type <span className="font-mono normal-case tracking-normal text-foreground">{target}</span>{' '}
        to confirm
      </label>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <input
          id={`post-confirm-${entry.number}`}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          aria-describedby={`post-why-${entry.number}`}
          className="w-28 rounded-md border border-border bg-background px-2 py-1 text-[13px] text-foreground focus:border-primary focus:outline-none"
          placeholder={target}
        />
        <button
          type="submit"
          disabled={post.pending || !matches}
          className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {post.pending ? 'Posting…' : 'Post entry'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setConfirm('')
            setRefusal(null)
          }}
          className="px-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
      <p id={`post-why-${entry.number}`} className="mt-1.5 text-[11.5px] text-muted-foreground">
        {/* Not an error state and not a scold: nothing has failed, and the box
            is empty because the reader has not typed yet. Same treatment the
            resolve form gives its own empty explanation. */}
        The entry&apos;s own #number, so that this is typed against the record in front of you
        rather than pressed. The database checks the entry again at the last moment — balanced, at
        least two lines, every line mapped — and refuses in its own words if it is not.
      </p>

      {refusal && (
        <div
          role="alert"
          data-refusal={refusal.code}
          className="mt-2 rounded-md border border-destructive/40 bg-background px-2.5 py-2"
        >
          {/* ── VERBATIM. The 0004 guard's refusal is the real answer. ──────
              `guard_refused` is migration 0004's deferred constraint speaking at
              COMMIT, translated out of Postgres's phrasing by the route and
              otherwise untouched. Rewording it here would be this app
              paraphrasing the rule that encodes art. 957a CO. */}
          <p className="text-[12.5px] text-foreground">{refusal.message}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">{refusal.code}</p>
          {/* ── A COMPLIANCE PASS REFUSED, AND ITS SENTENCE IS ABOVE ────
              `postEntry`'s one enforced consequence: a `blocked` verdict refuses
              to post, server side, *"a fresh verdict (or a correction of what it
              flagged) is the way through — never a force flag."* The message
              already carries the agent's own `resolves` text as its suggestion,
              printed verbatim above; this only says whose refusal it is, because
              the reader would otherwise read a compliance judgment as a
              bookkeeping error. */}
          {refusal.code === 'verdict_blocked' && (
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              That is a compliance pass refusing, not the books. The entry is unchanged and still
              staged. There is no override: what clears it is a fresh verdict from a pass that no
              longer finds the problem.
            </p>
          )}
          {refusal.code === 'guard_refused' && (
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              That is the database refusing at the last moment, in its own words. The entry was not
              posted and nothing about it changed.
            </p>
          )}
          {/* ── THE 500, WHICH IS ALMOST CERTAINLY THE 0004 GUARD ───────────
              Not a paraphrase of the guard and not a claim about which of its
              three rules refused — this screen was not told. What it CAN say
              truthfully is that the entry is unchanged (the transaction rolled
              back, so it is still staged), which of the three conditions the
              database tests, and where to get the real sentence. See the header
              for why the sentence is missing and for the narrowness of this
              branch. */}
          {/* ── THE 500 BRANCH IS GONE, 2026-08-19 ────────────────────────
              A block lived here explaining that the database had refused, that
              the entry was unchanged, and that which of the three conditions it
              failed "was not sent to this screen". All of that was true: the
              route read `e.message`, drizzle put the database's sentence on the
              cause chain, and every guard refusal arrived as a bare 500.

              The backend fixed it in the hardening pass, and it was verified
              here before this block was deleted rather than on the strength of
              the commit message — an entry with two mapped, unbalanced lines
              now answers:

                400  entry does not balance: debit 77.00 <> credit 99.00
                hint: resolve the lines, then post

              So the refusal prints verbatim through the ordinary path above, and
              a workaround that explains a missing sentence is worse than nothing
              once the sentence arrives. */}
        </div>
      )}
    </form>
  )
}

/**
 * What the screen says after a post, INCLUDING the re-post.
 *
 * Kept beside the form rather than inlined into the page, because the two
 * sentences it chooses between are the point of the whole component and putting
 * them in a 300-line page is how one of them gets edited into the other.
 */
export function PostedNotice({ result }: { result: PostResult }) {
  // POSITIVE, and against a boolean. See this file's header: `already` falsy
  // through absence would render a re-post as a fresh post.
  const already = result.already === true

  return (
    <p
      role="status"
      data-posted={result.number}
      data-already={String(already)}
      className="mt-2 rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-[12px] text-foreground"
    >
      {already ? (
        <>
          <span className="font-medium">Already posted.</span> Entry #{result.number} (journal n°{' '}
          {result.entry_no}) was in the books before this. Nothing changed, and that is not a
          failure — this write is deliberately safe to repeat, because the agents that drive this
          product retry.
        </>
      ) : (
        <>
          <span className="font-medium">Posted.</span> Entry #{result.number} is journal n°{' '}
          {result.entry_no} and is now part of the record. Its amounts and accounts are fixed; a
          correction from here is a new reversing entry.
        </>
      )}
    </p>
  )
}

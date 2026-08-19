'use client'

// The Devil's Advocate's verdict on one entry — read here, written elsewhere.
//
// ===========================================================================
// `verdict: null` MEANS NEVER CHECKED. IT DOES NOT MEAN CLEAN.
// ===========================================================================
// This panel renders on EVERY entry, including the ones nothing has ever looked
// at, and that is the point of it. A screen that drew the absence of a verdict
// as an accepted one would invent an assurance nobody gave — and in this product
// that assurance is the difference between "a compliance pass read this entry
// and passed it" and "nothing has ever read this entry".
//
// The four states are enumerated in `lib/verdict.ts`, where a test can reach
// them, and nothing here has a falsy branch. `never_checked` is drawn CALM, not
// as a warning: most entries in this product have never been through a pass,
// because the pass is an external agent run nobody has scheduled, and drawing
// every one of them amber would make the state meaningless.
//
// ===========================================================================
// THE APP FILES NO VERDICT AND THIS PANEL OFFERS NO BUTTON
// ===========================================================================
// `POST /entries/{n}/verdict` is the agent's door — ring 0, an append from
// outside, decision D-H's rule — and `bk books verdict` is how it is reached.
// The pass reads the rules and the records and files a structured answer back;
// it never corrects the record. This app stores it, renders it, and enforces
// exactly ONE consequence, on the server: a blocked entry refuses to post.
//
// ── AND THE REFUSAL'S WAY OUT IS THE AGENT'S OWN TEXT ───────────────────
// `postEntry` raises `verdict_blocked` with `v.resolves` as its suggestion when
// the agent filed one. So this panel prints that same sentence, from the same
// field, and `<PostEntryForm>` prints the route's version when a post is
// actually attempted. Two renderings of one string, deliberately: a reader must
// see the way out before they press, not only after.

import Link from 'next/link'
import { blocksPosting, citedRules, resolutionText, verdictFace, worstCaseText } from '@/lib/verdict'
import { TonePill } from './tone-pill'
import { DateText } from './date-text'
import { scopedHref } from '@/lib/nav'
import type { Verdict } from '@/lib/types'

export function VerdictPanel({
  verdict,
  base,
  scope,
}: {
  verdict: Verdict | null
  base: string
  scope: { entity: string | null; exercice: number | null }
}) {
  const face = verdictFace(verdict)
  const rules = citedRules(verdict)
  const resolves = resolutionText(verdict)
  const worst = worstCaseText(verdict)

  return (
    <div data-verdict={face.state}>
      <div className="flex flex-wrap items-center gap-2">
        <TonePill tone={face.tone} value={verdict?.verdict ?? 'null'}>
          {face.label}
        </TonePill>
        {verdict && (
          <span className="text-[11.5px] text-muted-foreground">
            <DateText value={verdict.at} /> · {verdict.by}
          </span>
        )}
      </div>

      <p className="mt-1.5 text-[12.5px] text-muted-foreground">{face.meaning}</p>

      {face.state === 'never_checked' && (
        <p className="mt-1 text-[11.5px] text-muted-foreground">
          A compliance pass runs outside this app and files its answer back through{' '}
          <span className="font-mono">bk books verdict</span>. There is no button here that would
          produce one: this app computes no compliance judgment of its own, deliberately.
        </p>
      )}

      {/* ── A VERDICT WITH NO RULES IS A MALFORMED RECORD, NOT A CLEAN ONE ──
          `recordVerdict` refuses `missing_rules` — *"a verdict names the rules
          that triggered — flags are facts, not moods"* — so an empty array here
          means the row did not come through that route. Saying so beats drawing
          a verdict with no basis as though it had one. */}
      {verdict && rules.length === 0 && (
        <p role="alert" className="mt-1.5 text-[11.5px] text-destructive">
          This verdict names no rule. Every verdict filed through the route must name at least one,
          so nothing here says what it was based on.
        </p>
      )}

      {rules.length > 0 && (
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
          Triggered:{' '}
          {rules.map((id, i) => (
            <span key={id}>
              {i > 0 && ', '}
              {/* Deep-linked into the register, which highlights it. The rule id
                  is the one thing a person needs next, and it is otherwise a
                  string they would have to go and look up. */}
              <Link
                href={scopedHref(base, '/compliance', scope, { rule: id }) + `#${id}`}
                className="font-mono text-primary-strong hover:underline"
              >
                {id}
              </Link>
            </span>
          ))}
        </p>
      )}

      {worst && (
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          <span className="font-medium text-foreground">Worst case:</span> {worst}
        </p>
      )}

      {/* ── THE WAY OUT, VERBATIM, AND ONLY WHEN IT IS ONE ─────────────────
          `resolves` is jsonb: whatever the agent wrote. `resolutionText` returns
          it only when it is a plain string, which is the same test `postEntry`
          applies before putting it in the refusal — so this shows the sentence
          the server would show, and never `[object Object]` in a recovery
          instruction. */}
      {blocksPosting(verdict) && (
        <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2">
          <p className="text-[12.5px] font-medium text-foreground">
            This entry will not post while the verdict stands.
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {resolves ? (
              <>
                <span className="text-foreground">The way out, as the pass filed it:</span>{' '}
                {resolves}
              </>
            ) : (
              <>
                The pass did not file a resolution in a form this screen can print, so there is no
                sentence to quote. <span className="font-mono">bk books entry show</span> prints the
                verdict as stored.
              </>
            )}
          </p>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            There is no override and there is no force flag. What clears it is a fresh verdict from
            a pass that no longer finds the problem — or a correction to what it found.
          </p>
        </div>
      )}
    </div>
  )
}

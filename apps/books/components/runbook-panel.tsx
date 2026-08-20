'use client'

// The pull runbook — deterministic steps, a vault reference, a version.
//
// ===========================================================================
// `credential_ref` IS RENDERED, IN FULL, AND THAT IS THE DESIGN
// ===========================================================================
// It is a REFERENCE — `vault://blackcode/yapeal` — and a reference is only
// useful if you can read it and go get the thing. So it is shown, in the mono
// treatment every other machine-readable value in this app gets, labelled as a
// reference in the sentence beside it.
//
// **There is deliberately no masking component in this app, and building one
// would be worse than nothing.** If a real secret ever appears in this field,
// the payload already carries it: it is in `GET …/sources/{n}`, in
// `bk books source show --json`, in the query cache, in the browser's network
// panel and in whatever log touched the response. Blurring the six characters a
// reader sees changes none of that while making the screen look like the problem
// was handled — and a handled-looking screen is how a leaked credential survives
// a review. **The fix is rotation, upstream, by whoever wrote the runbook.**
//
// That claim is worth stating where somebody will read it, so it is in the
// panel's own footnote and not only in this comment.
//
// ── THE FAILURE WINDOWS ARE SERVED, NOT RE-DERIVED ───────────────────────
// `windows` comes down with the source. Recomputing "stale after 10 days" here
// from `expected` would be a second copy of `sourceWindows`, and the two would
// drift the day somebody changes a threshold — with the screen quietly
// explaining a status by a rule the server no longer uses.

'use client'

import { DateText } from './date-text'
import { useT } from '@/lib/i18n'
import type { Source, SourceRunbook } from '@/lib/types'

export function RunbookPanel({
  runbook,
  source,
}: {
  runbook: SourceRunbook
  source: Source
}) {
  const t = useT()
  const cadence =
    !source.expected || source.expected === 'none' ? t('runbook.manual') : source.expected

  return (
    <section className="rounded-lg border border-border">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-medium text-foreground">{t('runbook.title')}</h2>
        <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          v{runbook.version}
        </span>
        <span className="text-[11.5px] text-muted-foreground">
          {t('runbook.updated')} <DateText value={runbook.updated} />
        </span>
      </div>

      <dl className="divide-y divide-border">
        <Field label={t('runbook.login')}>
          {runbook.login_url ? (
            <span className="font-mono text-[12px] break-all">{runbook.login_url}</span>
          ) : (
            <NotRecorded what={t('runbook.noLogin')} />
          )}
        </Field>
        <Field label={t('runbook.credentials')}>
          {runbook.credential_ref ? (
            <span className="font-mono text-[12px] break-all" data-credential-ref={runbook.credential_ref}>
              {runbook.credential_ref}
            </span>
          ) : (
            <NotRecorded what={t('runbook.noCredentials')} />
          )}
        </Field>
        <Field label={t('runbook.output')}>
          {runbook.output ? (
            <span className="font-mono text-[12px]">{runbook.output}</span>
          ) : (
            <NotRecorded what={t('runbook.noOutput')} />
          )}
        </Field>
        <Field label={t('runbook.cadence')}>
          <span>
            {cadence}
            {source.expected && source.expected !== 'none' ? (
              <span className="ml-2 text-muted-foreground">
                {t('runbook.windows', {
                  stale: source.windows.stale_after_days,
                  gap: source.windows.gap_after_days,
                })}
              </span>
            ) : (
              <span className="ml-2 text-muted-foreground">{t('runbook.noCadence')}</span>
            )}
          </span>
        </Field>
      </dl>

      <div className="border-t border-border px-4 py-3">
        <h3 className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
          {t('runbook.steps')}
        </h3>
        {runbook.steps.length === 0 ? (
          <NotRecorded what={t('runbook.noSteps')} />
        ) : (
          <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[12.5px] text-foreground">
            {runbook.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        )}
      </div>

      <p className="border-t border-border px-4 py-2.5 text-[11.5px] text-muted-foreground">
        <span className="font-medium text-foreground">{t('runbook.vaultLead')}</span>
        {t('runbook.vaultBody')}
      </p>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-2 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-40 shrink-0 text-[11.5px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 text-[12.5px] text-foreground">{children}</dd>
    </div>
  )
}

/**
 * A field the payload did not carry.
 *
 * **Never an em dash and never a blank.** An absent login URL and an empty
 * string are different facts, and a runbook missing the thing you need it for
 * has to look missing — the standing rule about falsy fallbacks, on a panel
 * whose whole purpose is that somebody can follow it.
 */
function NotRecorded({ what }: { what: string }) {
  return <span className="text-[12px] italic text-muted-foreground">{what}</span>
}

'use client'

// Trash — what was deleted, and when it goes.
//
// ── READ-ONLY, INCLUDING HERE, AND ESPECIALLY HERE ──────────────────────────
// There is no Restore button and no Empty button. D-7 renders no mutation
// affordance in `read_only`, and of every page in this app this is the one where
// a stray button costs the most: `bk sales trash purge` is irreversible and
// `Confirm()` auto-approves for agents, which is why the CLI makes the caller
// repeat the target back. A web button with none of that protection would be
// the weakest path to the most destructive verb.
//
// Restoring is `bk sales trash restore <type>:<n>`, which records who did it.
//
// ── THE 90-DAY HORIZON IS THE PRODUCT, NOT A DETAIL (D-19 item 1) ──────────
// This app holds names, emails, phone numbers and free-text notes about people
// at other companies. Retention is the control, so the page says when each row
// goes rather than only when it arrived — a bin that shows a delete date and
// hides the purge date is telling you the less useful half.

import { BlockSkeleton, EmptyState, ErrorState } from '@/components/states'
import { useTrash } from '@/lib/hooks'
import { dayLabel, relativeDay } from '@/lib/format'

/** D-19 item 1. Declared here for display only — the schedule enforces it. */
const RETENTION_DAYS = 90

export function TrashPage({ ws }: { ws: string }) {
  const trash = useTrash(ws)

  if (trash.isPending) return <BlockSkeleton rows={4} />
  if (trash.error) return <ErrorState error={trash.error} />
  if (trash.data.length === 0) {
    return <EmptyState title="Nothing in the bin" hint={`Deleted records are kept for ${RETENTION_DAYS} days, then purged.`} />
  }

  return (
    <div className="space-y-3">
      <p className="px-1 text-xs text-muted-foreground">
        Deleted records are kept for {RETENTION_DAYS} days, then purged
        automatically. Restoring one is the agent&rsquo;s job — ask for it by
        name and number.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Ref</th>
              <th className="py-2 pr-3 font-medium">Title</th>
              <th className="py-2 pr-3 font-medium">Deleted</th>
              <th className="py-2 pr-3 font-medium">By</th>
              <th className="py-2 pr-3 font-medium">Purges</th>
            </tr>
          </thead>
          <tbody>
            {trash.data.map((t, i) => (
              <tr key={`${t.type}-${t.number ?? i}`} className="border-b border-border/60">
                <td className="py-3 pr-3">
                  {/* `type:number` — the ref a human pastes straight into
                      `bk sales trash restore`. That is why it is rendered as
                      code rather than prettified. */}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    {t.type}
                    {t.number != null ? `:${t.number}` : ''}
                  </code>
                </td>
                <td className="py-3 pr-3 text-foreground">{t.title}</td>
                <td className="py-3 pr-3 text-muted-foreground">
                  {t.deleted_at ? dayLabel(t.deleted_at.slice(0, 10)) : '—'}
                </td>
                <td className="py-3 pr-3 text-muted-foreground">{t.deleted_by ?? '—'}</td>
                <td className="py-3 pr-3 text-muted-foreground">
                  {t.deleted_at ? relativeDay(purgeDay(t.deleted_at)) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** `deleted_at` + the retention horizon, as a `YYYY-MM-DD` day. */
function purgeDay(deletedAt: string): string {
  const d = new Date(deletedAt)
  d.setDate(d.getDate() + RETENTION_DAYS)
  return d.toISOString().slice(0, 10)
}

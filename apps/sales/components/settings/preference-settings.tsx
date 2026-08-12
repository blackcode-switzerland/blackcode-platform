'use client'

// The read-only / full switch (D-7), and the copy that keeps it honest.
//
// ===========================================================================
// THE SENTENCE BELOW IS MANDATORY, NOT DECORATION
// ===========================================================================
// D-7 lists three mitigations, without which this toggle is the exact pattern
// CLAUDE.md's standing rule exists for — a control that looks like a permission,
// is enforced only in React, and sits on the page of the person it supposedly
// restricts:
//
//   1. the default is `read_only`   → `lib/db/queries/preferences.ts`
//   2. no server module reads it    → `lib/ui-mode.test.ts`
//   3. THE COPY SAYS SO PLAINLY     → this file
//
// The third is the one a redesign quietly loses. It is not a footnote and it is
// not a tooltip: it sits under the control, in the same type size as the labels,
// because somebody deciding whether this protects anything has to read it
// without looking for it.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiSend, wsPath } from '@/lib/client'
import { BlockSkeleton, ErrorState, ticks } from '@/components/states'
import { useUiPreferences } from '@/lib/ui-mode'
import { UI_MODES } from '@/lib/pipeline'
import { Section } from './profile-settings'

export function PreferenceSettings({
  workspaces,
}: {
  workspaces: Array<{ slug: string; name: string }>
}) {
  if (workspaces.length === 0) {
    // The dashboard layout renders its "no access to b/sales" empty before this
    // page is reachable, so getting here means the two disagreed.
    return <ErrorState error={new Error('No workspace to set preferences for.')} />
  }
  return (
    <div className="space-y-6">
      {workspaces.map((w) => (
        <WorkspacePreferences key={w.slug} ws={w.slug} name={w.name} showName={workspaces.length > 1} />
      ))}
    </div>
  )
}

function WorkspacePreferences({
  ws,
  name,
  showName,
}: {
  ws: string
  name: string
  showName: boolean
}) {
  const prefs = useUiPreferences(ws)
  const qc = useQueryClient()
  const [saving, setSaving] = useState<string | null>(null)

  // Not `useRecordMutation` — that one refuses in read-only, and a switch that
  // could not be switched back out of read-only would be a lock rather than a
  // preference. This is also not a sales record: `lib/read-only.test.ts` allows
  // this call site by name and requires it to name a preferences path.
  const save = useMutation({
    mutationFn: (ui_mode: string) => apiSend('PATCH', wsPath(ws, '/preferences'), { ui_mode }),
    onMutate: (ui_mode) => setSaving(ui_mode),
    onSuccess: () => {
      // Every affordance in the app reads this key. Invalidating it is what
      // makes the change take effect without a reload.
      qc.invalidateQueries({ queryKey: ['preferences', ws] })
      toast.success('Preference saved')
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setSaving(null),
  })

  return (
    <Section
      title={showName ? `Editing in ${name}` : 'Editing in the web app'}
      note="A display preference for this browser. It is not a permission."
    >
      {prefs.isPending ? (
        <BlockSkeleton rows={2} />
      ) : prefs.error ? (
        <ErrorState error={prefs.error} />
      ) : (
        <div className="space-y-2">
          {UI_MODES.map((m) => {
            const active = prefs.data.ui_mode === m.value
            return (
              <label
                key={m.value}
                className={
                  'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors ' +
                  (active ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/40')
                }
              >
                <input
                  type="radio"
                  name={`ui-mode-${ws}`}
                  checked={active}
                  disabled={save.isPending}
                  onChange={() => save.mutate(m.value)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    {m.label}
                    {saving === m.value && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">saving…</span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {/* `ticks` is kept even though no string here names a
                        command any more: it costs nothing on a string with no
                        backticks, and removing it is how the literal-backtick
                        bug of 2026-08-11 comes back. The fallback is the branch
                        nobody sees until the vocabulary gains a mode — which is
                        exactly why it was the one left unrendered then. */}
                    {ticks(
                      DESCRIPTIONS[m.value] ??
                        'This build does not know what this mode means — it was added after the app was deployed.'
                    )}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      )}

      {/*
        D-7 mitigation 3, verbatim from the decision. Under the control, in the
        same type size as the option descriptions.
      */}
      <p className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        {/*
          D-7's whole point survives without naming the binary. The claim that
          matters is "this is a display preference, not a permission", and the
          evidence for it is that the agent writes regardless — which is a fact
          about who can change your data, not a command anybody reading this
          page is going to type.
        */}
        <strong className="font-medium text-foreground">Read-only hides editing in this browser.
        It is not a permission</strong> — the agent still writes to this workspace either way, and
        anyone who can open this app can switch the toggle back. What you may do is decided by your
        access to b/sales and your role in this workspace, and this setting changes neither. If
        somebody must genuinely be unable to write, that is a role, not a toggle — ask an owner.
      </p>
    </Section>
  )
}

// Keyed by value with a stated fallback, rather than a fixed pair. `UI_MODES`
// is a vocabulary served live by `bk meta` and can gain a value without a deploy
// of this page; a third mode would otherwise render with no description at all,
// which reads as a bug rather than as a mode nobody has written copy for.
const DESCRIPTIONS: Record<string, string> = {
  read_only:
    'The pipeline is a ledger. Nothing here can be edited from the browser — the agent writes it, you read it. This is the default.',
  full:
    'Show editing for the things a person learns first-hand: a deal moving, a contact’s details, what a meeting turned into, an objection raised. The catalogue stays agent-written.',
}

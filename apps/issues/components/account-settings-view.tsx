'use client'

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { signOut } from 'next-auth/react'
import { toast } from 'sonner'
import { AlertTriangle, HelpCircle, KeyRound, Trash2 } from 'lucide-react'
import { PasswordResetFlow } from './password-reset-flow'

// ─────────────────────────────────────────────────────────────────────────────
// THE CENSUS, AS THE SCREEN SEES IT
// ─────────────────────────────────────────────────────────────────────────────
// A discriminated union, mirroring `AppCensusEntry` on the server, and the
// discrimination is the safety property rather than a convenience. An app that
// did not answer has NO `footprint` field — so there is no place for this
// component to read a `0` when the truth is "unknown", and rendering it as
// nothing does not typecheck.
//
// Two rules follow, and both are implemented below:
//   * unreachable apps are rendered BY NAME, as unknown. Not omitted, not zero.
//   * "close everywhere" is disabled while any app is unreachable, and says why.
// "Delete just this app's data" stays available throughout — it is answerable
// locally and needs no census at all.
interface AppFootprint {
  known: boolean
  blocked_by: Array<{ workspace_id: number; name: string; member_count: number }>
  will_delete: Array<{ workspace_id: number; name: string }>
  holds: Array<{ label: string; count: number }>
}

type CensusEntry =
  | { app: string; name: string; is_current: boolean; reachable: true; footprint: AppFootprint }
  | { app: string; name: string; is_current: boolean; reachable: false; error: string }

interface DeleteReport {
  // WHICH APP THIS REPORT COVERS. Required, and rendered — see the note in
  // `DeleteAccountReport` (packages/platform-db/src/account.ts). A report that
  // can only see one app's workspaces and presents them as a total reads as
  // authoritative, which is worse than reading as empty.
  app: { slug: string; name: string }
  blocked_by: Array<{ workspace_id: number; name: string; member_count: number }>
  will_hard_delete: Array<{ workspace_id: number; name: string }>
  /** Every app in the suite, including this one. */
  apps: CensusEntry[]
}

/** What the person chose. There is no default: they have to pick. */
type Scope = 'this_app' | 'all_apps'

export function AccountSettingsView() {
  const [confirming, setConfirming] = useState(false)
  const [phrase, setPhrase] = useState('')
  const [changingPw, setChangingPw] = useState(false)
  const [scope, setScope] = useState<Scope | null>(null)

  const me = useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<{ email: string }> => {
      const res = await fetch('/api/me')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  const report = useQuery({
    queryKey: ['delete-account-report'],
    enabled: confirming,
    queryFn: async (): Promise<DeleteReport> => {
      const res = await fetch('/api/me?dry_run=true', { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  const remove = useMutation({
    mutationFn: async (chosen: Scope) => {
      // TWO DIFFERENT ROUTES, and that is the design rather than a branch.
      //
      // "This app only" is `DELETE /api/me/footprint` — the app's own data, in
      // the app that holds it, needing no census and never touching the
      // account. "All apps" is `DELETE /api/me?scope=all_apps`, which reads the
      // address book, purges every other app first and closes the account last.
      //
      // `scope` is spelled out even though this is the only caller: the route's
      // meaning widened to reach every app, and an irreversible operation that
      // does more than the caller asked is the wrong place for a default.
      const url = chosen === 'all_apps' ? '/api/me?scope=all_apps' : '/api/me/footprint'
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message ?? j.error ?? 'failed')
      }
      return res.json()
    },
    onSuccess: (_data, chosen) => {
      // Both paths sign out, and only one of them closed the account.
      //
      // "This app only" leaves an account that can still sign in — which is the
      // point, because the account is the shared thing and other apps may still
      // hold data. Signing out anyway is honest: everything this session could
      // reach here is gone, and leaving somebody sitting in an empty dashboard
      // reads as a failed delete.
      toast.success(
        chosen === 'all_apps'
          ? 'Account closed everywhere'
          : 'Your data here has been deleted — your account is still open'
      )
      signOut({ callbackUrl: '/' })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // A census we could not complete cannot authorise an irreversible act. This
  // is the client half of the server's 409; the server refuses regardless, and
  // this exists so the person is told BEFORE they type DELETE rather than after.
  const unreachable = (report.data?.apps ?? []).filter((a) => !a.reachable)
  const otherAppsWithData = (report.data?.apps ?? []).filter(
    (a) =>
      !a.is_current &&
      a.reachable &&
      (a.footprint.will_delete.length > 0 || a.footprint.blocked_by.length > 0)
  )

  // A workspace with other people in it blocks, in WHICHEVER app it is in — the
  // rule `deleteAccountReport` has always had, asked of every app rather than of
  // one. Flattened with the app's name attached, because "Marketing is blocked"
  // is not actionable if you cannot tell which app to go and fix it in.
  const blockedAnywhere = (report.data?.apps ?? []).flatMap((a) =>
    a.reachable
      ? a.footprint.blocked_by.map((w) => ({ ...w, app: a.app, app_name: a.name }))
      : []
  )

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card/30 p-5">
        <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
          <KeyRound size={15} />
          Password
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Change your password using a one-time code sent to your email. You can use this to set a
          password for the first time too (for example if you signed up with Google).
        </p>
        {changingPw ? (
          <PasswordResetFlow
            authenticated
            presetEmail={me.data?.email}
            onCancel={() => setChangingPw(false)}
            onDone={() => {
              setChangingPw(false)
              // The password change invalidated this session — sign out and
              // send the user back to log in with their new password.
              toast.success('Password changed — please sign in again')
              signOut({ callbackUrl: '/login' })
            }}
          />
        ) : (
          <button
            onClick={() => setChangingPw(true)}
            className="cursor-pointer rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary"
          >
            Change password
          </button>
        )}
      </section>

      <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-5">
      <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-destructive">
        <AlertTriangle size={15} />
        Delete account
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Your blackcode account is one login for every app, and each app keeps its own workspaces and
        records. You can delete your data in one app and keep your account, or close the account
        everywhere.
      </p>

      {!confirming ? (
        <div className="flex justify-end">
          <button
            onClick={() => setConfirming(true)}
            className="cursor-pointer flex items-center gap-1.5 rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
          >
            <Trash2 size={14} />
            Start account deletion
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {report.isLoading ? (
            <p className="text-xs text-muted-foreground">
              Asking every blackcode app what it holds for you…
            </p>
          ) : null}
          {report.error ? (
            <p className="rounded-md border border-destructive/40 p-3 text-xs text-destructive">
              Could not work out what you have. Nothing has been deleted — try again.
            </p>
          ) : null}
          {report.data ? (
            <>
              {/*
                THE CENSUS. Every app in the suite gets a row, including ones
                that did not answer and ones that hold nothing — a screen that
                only listed the apps with data would be unable to say the two
                most important things: "we checked there" and "we could not".
              */}
              <div className="space-y-2">
                {report.data.apps.map((a) => (
                  <AppRow key={a.app} entry={a} />
                ))}
              </div>

              {unreachable.length > 0 ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-400">
                  <strong>{unreachable.map((a) => a.name).join(', ')}</strong> did not answer, so we
                  do not know what you have there. You can still delete your {report.data.app.name}{' '}
                  data, but closing the account everywhere is unavailable until every app has been
                  asked — we will not destroy an account over an incomplete picture.
                </p>
              ) : null}

              {/*
                THE CHOICE. Radio buttons rather than two buttons: the two
                outcomes differ in whether the ACCOUNT survives, and a person
                should read both sentences before either is armed.
              */}
              <fieldset className="space-y-2">
                <legend className="mb-1 text-xs font-medium">What would you like to delete?</legend>
                <ScopeOption
                  checked={scope === 'this_app'}
                  onSelect={() => setScope('this_app')}
                  title={`My ${report.data.app.name} data only`}
                  detail={
                    otherAppsWithData.length > 0
                      ? `Your account stays open, and ${otherAppsWithData
                          .map((a) => a.name)
                          .join(', ')} keeps what it holds. You will be signed out.`
                      : 'Your account stays open and you can sign in again. You will be signed out.'
                  }
                />
                <ScopeOption
                  checked={scope === 'all_apps'}
                  onSelect={() => setScope('all_apps')}
                  disabled={unreachable.length > 0}
                  title="Close my account — every app"
                  detail={
                    unreachable.length > 0
                      ? `Unavailable: ${unreachable
                          .map((a) => a.name)
                          .join(', ')} could not be reached.`
                      : 'Deletes your data in every app above, revokes every API token and closes the account. This cannot be undone.'
                  }
                />
              </fieldset>

              {blockedAnywhere.length > 0 ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                  <p className="mb-2 font-medium text-amber-400">
                    You must transfer ownership of these workspaces first — other people are in
                    them:
                  </p>
                  <ul className="space-y-1">
                    {blockedAnywhere.map((w) => (
                      <li key={`${w.app}-${w.workspace_id}`} className="flex items-center justify-between">
                        <span>
                          {w.name} <span className="text-muted-foreground">({w.app_name})</span>
                        </span>
                        <span className="text-muted-foreground">
                          {w.member_count} {w.member_count === 1 ? 'member' : 'members'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {scope && blockedAnywhere.length === 0 ? (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-medium">
                      Type <code>DELETE</code> to confirm
                    </label>
                    <input
                      value={phrase}
                      onChange={(e) => setPhrase(e.target.value)}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setConfirming(false)
                        setPhrase('')
                        setScope(null)
                      }}
                      className="cursor-pointer rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={phrase !== 'DELETE' || remove.isPending}
                      onClick={() => remove.mutate(scope)}
                      className="cursor-pointer rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
                    >
                      {scope === 'all_apps'
                        ? 'Permanently close my account'
                        : `Permanently delete my ${report.data.app.name} data`}
                    </button>
                  </div>
                </>
              ) : (
                <button
                  onClick={() => {
                    setConfirming(false)
                    setScope(null)
                  }}
                  className="cursor-pointer rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
                >
                  Back
                </button>
              )}
            </>
          ) : null}
        </div>
      )}
      </section>
    </div>
  )
}

/**
 * ONE APP'S ROW — including, and especially, an app that did not answer.
 *
 * The union has no `footprint` on an unreachable entry, so this component
 * CANNOT render a zero it does not have. That is the whole safety property
 * expressed as a rendering constraint: an app we could not ask is shown by name
 * as unknown, never omitted and never as "nothing".
 */
function AppRow({ entry }: { entry: CensusEntry }) {
  if (!entry.reachable) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-medium">{entry.name}</span>
          <span className="flex items-center gap-1.5 text-amber-400">
            <HelpCircle size={13} />
            unknown — did not answer
          </span>
        </div>
        <p className="mt-1 text-muted-foreground">{entry.error}</p>
      </div>
    )
  }

  const { footprint } = entry
  const nothing = footprint.will_delete.length === 0 && footprint.blocked_by.length === 0

  return (
    <div className="rounded-md border border-border p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {entry.name}
          {entry.is_current ? <span className="ml-2 text-muted-foreground">(this app)</span> : null}
        </span>
        {nothing ? (
          <span className="text-muted-foreground">
            {/* "You have nothing here" and "you have never been here" are
                different sentences on purpose — the same distinction
                /api/meta's `workspaces: []` carries. */}
            {footprint.known ? 'nothing of your own' : 'you have no account here'}
          </span>
        ) : null}
      </div>
      {footprint.will_delete.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {footprint.will_delete.map((w) => (
            <li key={w.workspace_id} className="text-destructive">
              {w.name}
            </li>
          ))}
        </ul>
      ) : null}
      {footprint.holds.length > 0 ? (
        <p className="mt-1 text-muted-foreground">
          {footprint.holds.map((h) => `${h.count} ${h.label}`).join(' · ')}
        </p>
      ) : null}
    </div>
  )
}

function ScopeOption({
  checked,
  onSelect,
  title,
  detail,
  disabled,
}: {
  checked: boolean
  onSelect: () => void
  title: string
  detail: string
  disabled?: boolean
}) {
  return (
    <label
      className={`flex gap-2.5 rounded-md border p-3 text-xs ${
        disabled
          ? 'cursor-not-allowed border-border opacity-60'
          : 'cursor-pointer border-border hover:bg-secondary/40'
      } ${checked ? 'border-primary' : ''}`}
    >
      <input
        type="radio"
        name="delete-scope"
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
      />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-muted-foreground">{detail}</span>
      </span>
    </label>
  )
}

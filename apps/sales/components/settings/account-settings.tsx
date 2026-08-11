'use client'

// The account page: what is done here, and what deliberately is not.
//
// ===========================================================================
// EACH ABSENCE IS A DECISION, AND EACH ONE NAMES WHERE THE CONTROL IS
// ===========================================================================
//
// **Changing your password USED TO BE ONE OF THEM. IT IS DONE HERE NOW**
// (2026-08-11, Phase 10). The old reason was real and is spent: the shared
// factories existed, and `passwordRequestOtpRoute` takes a SENDER as a required
// second argument, and sales had no email infrastructure — no Resend key, no
// from-address, no templates. Mounting it anyway would have produced the worst
// available outcome: "we sent a code to b•••@…" with a 200, and nothing
// arriving.
//
// `packages/platform-email` closed that, so this app mounts both factories and
// the control is where the person looking for it is. **The honest-degradation
// worry did not go away, it moved into the server**: a deployment that cannot
// deliver answers 503 `email_not_configured` instead of a cheerful 200, so the
// failure this paragraph was written about is now a sentence on screen rather
// than a silence.
//
// This is also the screen the user objected to. Sending somebody to another app
// to change the one password both apps share was never a policy decision — it
// was `apps/issues/lib/email/` never having become a package.
//
// **Deleting your ACCOUNT.** Irreversible, and it reaches across every app:
// soft-deletes the user, hard-deletes solely-owned workspaces in every app,
// revokes every token. None of that is a sales operation. `app/api/me/route.ts`
// still does not export DELETE, and that decision is unchanged.
//
// **Deleting your b/sales DATA is a different act, and it is done HERE.**
// Added 2026-08-11 (Phase 9). Nothing else can do it: no other deployment can
// read or write `sales.*`. Until then, closing a blackcode account from
// `apps/issues` left this app's workspace in place — prospects, meetings,
// communications, documents — owned by an account that could no longer sign in.
// Not lost: STRANDED, and unrecoverable by the person. So the two acts sit next
// to each other on this page and say plainly which one keeps the account.
//
// **Platform administration.** Settled 2026-08-07: it lives in ONE app, and not
// this one. D-28's test decides it — *would two deployments answer differently?*
// `platform.users` and `platform.error_events` are the same rows from any host,
// which is also why `docs/backend.md` §7.1 records `bk super-admin errors` as
// permanently unmounted here. Building a second copy of an admin surface is the
// tier mistake D-28 exists to prevent. `docs/frontend.md` §11 carries the
// ruling and the two options it beat.
//
// For the two that ARE elsewhere, the page NAMES the place, and the name is
// DERIVED — the
// server resolved which apps exist and where they live
// (`platform.apps.base_url`, the D-18 mechanism). This app's code never spells
// another app's slug.

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { signOut } from 'next-auth/react'
import { toast } from 'sonner'
import { KeyRound, LogOut, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import { apiGet, apiSend } from '@/lib/client'
import { BlockSkeleton, ErrorState } from '@/components/states'
import { Section } from './profile-settings'
import { PasswordResetFlow } from '@/components/password-reset-flow'

interface Footprint {
  known: boolean
  blocked_by: Array<{ workspace_id: number; name: string; member_count: number }>
  will_delete: Array<{ workspace_id: number; name: string }>
  holds: Array<{ label: string; count: number }>
}

interface Me {
  email: string
  connected_google: boolean
  is_super_admin: boolean
}

export interface OtherApp {
  name: string
  url: string
}

export function AccountSettings({ otherApps }: { otherApps: OtherApp[] }) {
  const me = useQuery({ queryKey: ['me'], queryFn: () => apiGet<Me>('/api/me') })

  if (me.isPending) return <BlockSkeleton rows={3} />
  if (me.error) return <ErrorState error={me.error} />

  return (
    <div className="space-y-6">
      <Section
        title="Signed in"
        note="One account, one sign-in, every blackcode app (D-16). Signing out here signs you out everywhere."
      >
        <p className="text-sm text-foreground">{me.data.email}</p>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
        >
          <LogOut size={15} />
          Sign out
        </button>
      </Section>

      <Section
        title="Password"
        note="One password for every blackcode app. Changing it here signs you out everywhere, including this session."
      >
        <ChangePassword email={me.data.email} />
      </Section>

      <Section title="Deleting your b/sales data">
        <DeleteMyData />
      </Section>

      <Section title="Closing your account">
        <Elsewhere icon={<ShieldAlert size={15} />} apps={otherApps} where="Settings → Account">
          Closing a blackcode account is irreversible and reaches every app: it revokes all your API
          tokens and permanently deletes workspaces you solely own, <strong>including the b/sales
          data above</strong>. It is deliberately done in one place, with a typed confirmation,
          rather than from each app that happens to be open.
        </Elsewhere>
      </Section>

      {/*
        Shown to everybody, not only to super admins. `is_super_admin` says
        whether this person HAS the surface; it does not say where the surface
        is, and hiding the sentence from somebody who does not have it would mean
        the one person who goes looking is the one person not told. It costs a
        line and it answers a question that otherwise ends in a support message.
      */}
      <Section title="Platform administration">
        <Elsewhere
          icon={<ShieldCheck size={15} />}
          apps={otherApps}
          where="Settings → Super admin"
        >
          Users, error events and the drift reconcilers are <strong>platform-wide</strong> — the
          same rows whichever app you ask, which is why they are served from one place rather than
          copied into each. b/sales has no administration screens of its own and will not grow any.
        </Elsewhere>
      </Section>
    </div>
  )
}

/**
 * Change the password of the account you are signed in as: request a code to
 * your own address, then set the new one.
 *
 * Collapsed behind a button rather than rendered open, because it is not what
 * most visits to this page are for — and expanded in place rather than in a
 * dialog, which is how `apps/issues` does it and one less thing to get wrong on
 * a narrow screen.
 *
 * On success it signs out. `password_changed_at` has already invalidated this
 * session server-side — every session carries a snapshot of that timestamp — so
 * the alternative is leaving somebody clicking around a page whose next request
 * will bounce them to the login screen with no explanation.
 */
function ChangePassword({ email }: { email: string }) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
      >
        <KeyRound size={15} />
        Change password
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <PasswordResetFlow
        authenticated
        presetEmail={email}
        onCancel={() => setOpen(false)}
        onDone={() => {
          toast.success('Password updated — signing you out')
          signOut({ callbackUrl: '/login' })
        }}
      />
    </div>
  )
}

/**
 * "This control exists, and it is over there."
 *
 * The link list is whatever the server resolved, so a person who can reach only
 * b/sales gets the sentence with no link — which is still the right answer, and
 * a great deal better than a control that is simply absent.
 */
function Elsewhere({
  icon,
  apps,
  where,
  children,
}: {
  icon: React.ReactNode
  apps: OtherApp[]
  where: string
  children: React.ReactNode
}) {
  return (
    <p className="flex items-start gap-2.5 text-sm text-muted-foreground">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>
        {children}{' '}
        {apps.length === 0 ? (
          <>
            It is done from another blackcode app, under{' '}
            <strong className="font-medium text-foreground">{where}</strong> — you do not currently
            have access to one.
          </>
        ) : (
          <>
            Go to{' '}
            {apps.map((a, i) => (
              <span key={a.url}>
                {i > 0 && (i === apps.length - 1 ? ' or ' : ', ')}
                {/* An <a>, not a <Link>: it leaves this deployment. Same reason
                    the Related block on a prospect uses one (D-18). */}
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  {a.name}
                </a>
              </span>
            ))}{' '}
            → <strong className="font-medium text-foreground">{where}</strong>.
          </>
        )}
      </span>
    </p>
  )
}

/**
 * "Delete my b/sales data" — this app only, and the account survives.
 *
 * ── WHY THIS IS NOT `DELETE /api/me` WITH A FLAG ───────────────────────────
 * It never touches `platform.users`. The account is the one thing every app
 * shares, and an app that could close it from a button labelled "delete my
 * b/sales data" would be doing considerably more than it said. The route is
 * `DELETE /api/me/footprint`, which is scoped to this app by construction: it
 * calls this deployment's own `FootprintSource`, which can only reach `sales.*`.
 *
 * ── AND WHY IT SIGNS YOU OUT ───────────────────────────────────────────────
 * Because everything this session could reach here is gone. Leaving somebody in
 * an empty dashboard reads as a failed delete. They can sign straight back in —
 * that is the difference between this and closing the account, and the toast
 * says so.
 *
 * `apiSend` rather than `useRecordMutation`: this is an ACCOUNT operation, not a
 * sales record, so it is not behind `useCanWrite()`. A browser display
 * preference that could stop somebody deleting their own data would have become
 * a permission over their account, which is the misreading D-7 exists to
 * prevent. Declared in `lib/read-only.test.ts`'s ACCOUNT_WRITERS with that
 * reason.
 */
function DeleteMyData() {
  const [confirming, setConfirming] = useState(false)
  const [phrase, setPhrase] = useState('')

  const footprint = useQuery({
    queryKey: ['my-footprint'],
    queryFn: () => apiGet<{ app: string; footprint: Footprint }>('/api/me/footprint'),
  })

  const remove = useMutation({
    mutationFn: () => apiSend<{ deleted: true }>('DELETE', '/api/me/footprint'),
    onSuccess: () => {
      toast.success('Your b/sales data has been deleted — your account is still open')
      signOut({ callbackUrl: '/login' })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (footprint.isPending) return <BlockSkeleton rows={2} />
  if (footprint.error) return <ErrorState error={footprint.error} />

  const f = footprint.data.footprint
  const blocked = f.blocked_by.length > 0

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        Deletes everything you have in b/sales — your workspace and all of its prospects, meetings,
        communications and documents. <strong className="text-foreground">Your blackcode account
        stays open</strong>, and so does anything you have in other apps. You will be signed out.
      </p>

      {f.will_delete.length === 0 && !blocked ? (
        <p className="text-muted-foreground">You have nothing of your own here to delete.</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {f.will_delete.map((w) => (
            <li key={w.workspace_id} className="text-destructive">
              {w.name}
            </li>
          ))}
          {f.holds.length > 0 ? (
            <li className="text-muted-foreground">
              {f.holds.map((h) => `${h.count} ${h.label}`).join(' \u00b7 ')}
            </li>
          ) : null}
        </ul>
      )}

      {blocked ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-500">
          Other people are in {f.blocked_by.map((w) => w.name).join(', ')}. Transfer ownership
          first — deleting it would take their data with it.
        </p>
      ) : f.will_delete.length === 0 ? null : !confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="flex items-center gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
        >
          <Trash2 size={15} />
          Delete my b/sales data
        </button>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs font-medium">
            Type <code>DELETE</code> to confirm
          </label>
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                setConfirming(false)
                setPhrase('')
              }}
              className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
            >
              Cancel
            </button>
            <button
              disabled={phrase !== 'DELETE' || remove.isPending}
              onClick={() => remove.mutate()}
              className="rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
            >
              Permanently delete my b/sales data
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

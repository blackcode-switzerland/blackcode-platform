'use client'

// The account page: what is done here, and what deliberately is not — modelled
// on apps/sales' `AccountSettings` (2026-08-11 Phase 10 / 2026-08-11 Phase 9).
//
// ── PASSWORD, DONE HERE ──────────────────────────────────────────────────────
// One login, one password, every blackcode app. `POST /api/me/password/request-otp`
// and `POST /api/me/password/confirm` are mounted in this app
// (`app/api/me/password/**`), through `lib/mutations.ts`' `useRequestPasswordOtp`
// / `useConfirmPassword` — no bespoke fetch. A success bumps
// `password_changed_at`, which invalidates every session issued before it,
// including this one, so the flow signs out on success.
//
// ── DELETING YOUR b/billing DATA, DONE HERE ─────────────────────────────────
// `DELETE /api/me/footprint` reaches only `billing.*` — nothing else can do it,
// because no other deployment can read or write this schema. The account
// survives; the toast and the copy say so.
//
// ── CLOSING THE ACCOUNT, NOT HERE ────────────────────────────────────────────
// `DELETE /api/me` is deliberately unexported everywhere (CLAUDE.md: "an agent
// must never delete its owner's account", `apps/billing/app/api/me/route.ts`'s
// header). It lives in exactly one app. The link below is built from
// `platform.apps.base_url` on the server — this file never names another app's
// slug — so following it and finding no workspace there is a normal, legible
// outcome.

import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { toast } from 'sonner'
import { KeyRound, LogOut, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import { useConfirm } from '@blackcode/platform-ui/ui/confirm-dialog'
import { Button } from '@blackcode/platform-ui/ui/button'
import { Input } from '@blackcode/platform-ui/ui/input'
import { useMe, useFootprint } from '@/lib/queries'
import { useRequestPasswordOtp, useConfirmPassword, useDeleteFootprint, toastError } from '@/lib/mutations'
import { Section, FormField, ErrorState, LoadingState } from '@/components/ui-kit'
import { APP_NAME } from '@/lib/app'

export interface OtherApp {
  name: string
  url: string
}

export function AccountSettings({ otherApps }: { otherApps: OtherApp[] }) {
  const me = useMe()

  if (me.isPending) return <LoadingState variant="detail" />
  if (me.error) return <ErrorState error={me.error} retry={me.refetch} />

  return (
    <div className="space-y-6">
      <Section title="Signed in" description="One account, one sign-in, every blackcode app. Signing out here signs you out everywhere.">
        <p className="text-sm text-foreground" data-testid="account-signed-in-email">
          {me.data.email}
        </p>
        <Button variant="outline" onClick={() => signOut({ callbackUrl: '/login' })} data-testid="account-sign-out">
          <LogOut size={15} />
          Sign out
        </Button>
      </Section>

      <Section title="Password" description="One password for every blackcode app. Changing it here signs you out everywhere, including this session.">
        <ChangePassword email={me.data.email} />
      </Section>

      <Section title="Deleting your billing data">
        <DeleteMyData />
      </Section>

      <Section title="Closing your account">
        <Elsewhere icon={<ShieldAlert size={15} />} apps={otherApps} where="Settings → Account">
          Closing a blackcode account is irreversible and reaches every app: it revokes all your API
          tokens and permanently deletes workspaces you solely own,{' '}
          <strong className="text-foreground">including the billing data above</strong>. It is
          deliberately done in one place, with a typed confirmation, rather than from each app that
          happens to be open.
        </Elsewhere>
      </Section>

      {/* Shown to everybody, not only to super admins — `is_super_admin` says
          whether this person HAS the surface, not where it is; hiding the
          sentence from somebody who lacks it would mean the one person who goes
          looking is the one person not told. */}
      <Section title="Platform administration">
        <Elsewhere icon={<ShieldCheck size={15} />} apps={otherApps} where="Settings → Super admin">
          Users, error events and the drift reconcilers are <strong className="text-foreground">platform-wide</strong> —
          the same rows whichever app you ask, which is why they are served from one place rather than
          copied into each. {APP_NAME} has no administration screens of its own.
        </Elsewhere>
      </Section>
    </div>
  )
}

/**
 * Request a code to your own address, then set the new one. Collapsed behind a
 * button rather than open by default — it is not what most visits are for.
 */
function ChangePassword({ email }: { email: string }) {
  const [step, setStep] = useState<'closed' | 'requested'>('closed')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const requestOtp = useRequestPasswordOtp()
  const confirmPassword = useConfirmPassword()

  if (step === 'closed') {
    return (
      <Button
        variant="outline"
        data-testid="change-password-open"
        onClick={async () => {
          try {
            // `useWrite`'s TVars cannot be inferred for a zero-arg send fn, so
            // it defaults to `unknown` and `mutateAsync` requires an argument;
            // `undefined` satisfies `unknown` without touching `lib/mutations.ts`.
            await requestOtp.mutateAsync(undefined)
            setStep('requested')
            toast.success(`Code sent to ${email}`)
          } catch (e) {
            toastError(e)
          }
        }}
        disabled={requestOtp.isPending}
      >
        <KeyRound size={15} />
        {requestOtp.isPending ? 'Sending code…' : 'Change password'}
      </Button>
    )
  }

  return (
    <div className="max-w-sm space-y-3 rounded-lg border border-border bg-card/40 p-3">
      <p className="text-xs text-muted-foreground">
        Enter the code sent to <strong className="text-foreground">{email}</strong> and your new
        password.
      </p>
      <FormField label="Code" htmlFor="otp">
        <Input id="otp" data-testid="input-otp" value={otp} onChange={(e) => setOtp(e.target.value)} autoComplete="one-time-code" />
      </FormField>
      <FormField label="New password" htmlFor="new-password">
        <Input
          id="new-password"
          data-testid="input-new-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </FormField>
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setStep('closed')
            setOtp('')
            setPassword('')
          }}
        >
          Cancel
        </Button>
        <Button
          data-testid="confirm-password"
          disabled={!otp.trim() || !password || confirmPassword.isPending}
          onClick={async () => {
            try {
              await confirmPassword.mutateAsync({ otp: otp.trim(), new_password: password })
              toast.success('Password updated — signing you out')
              signOut({ callbackUrl: '/login' })
            } catch (e) {
              toastError(e)
            }
          }}
        >
          {confirmPassword.isPending ? 'Updating…' : 'Set new password'}
        </Button>
      </div>
    </div>
  )
}

/**
 * "Delete my billing data" — this app only, and the account survives.
 *
 * Repeat-to-confirm via `useConfirm`'s prompt variant with `requireMatch` —
 * never `window.confirm`/`window.prompt`, per the platform rule.
 */
function DeleteMyData() {
  const footprint = useFootprint()
  const remove = useDeleteFootprint()
  const { prompt } = useConfirm()

  if (footprint.isPending) return <LoadingState count={2} />
  if (footprint.error) return <ErrorState error={footprint.error} retry={footprint.refetch} />

  const f = footprint.data.footprint
  const byMembers = f.blocked_by.filter((w) => (w.reason ?? 'members') === 'members')
  const byRetention = f.blocked_by.filter((w) => w.reason === 'retention')
  const blocked = f.blocked_by.length > 0
  const willDelete = f.will_delete

  async function onDelete() {
    const typed = await prompt({
      title: 'Delete your billing data',
      description: 'Type DELETE to confirm. This permanently removes the workspaces listed, with their members and invitations.',
      confirmLabel: 'Permanently delete',
      destructive: true,
      inputLabel: 'Confirmation',
      placeholder: 'DELETE',
      requireMatch: 'DELETE',
    })
    if (typed === null) return
    try {
      await remove.mutateAsync(undefined)
      toast.success('Your billing data has been deleted — your account is still open')
      signOut({ callbackUrl: '/login' })
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div className="space-y-3 text-sm">
      {/* Rewritten 2026-09-21. It used to promise to delete "your workspace
          and all of its companies, invoices, recurring series and imported
          history" — which the database has always refused (ten-year retention,
          BEFORE DELETE triggers that fire on the cascade), so the button
          answered with a 500. What can be deleted is a workspace nothing was
          ever issued from; the footprint reports the rest as a retention hold. */}
      <p className="text-muted-foreground">
        Deletes the workspaces you alone own in {APP_NAME} that nothing was ever issued from.
        Invoices, companies and their audit trail are{' '}
        <strong className="text-foreground">kept for ten years</strong> (art. 958f CO) and are never
        deleted — a workspace holding them stays.{' '}
        <strong className="text-foreground">Your blackcode account stays open</strong>, and so does
        anything you have in other apps. You will be signed out.
      </p>

      {willDelete.length === 0 && !blocked ? (
        <p className="text-muted-foreground">You have nothing of your own here to delete.</p>
      ) : (
        <ul className="space-y-1 text-xs" data-testid="footprint-will-delete">
          {willDelete.map((w) => (
            <li key={w.workspace_id} className="text-destructive">
              {w.name}
            </li>
          ))}
        </ul>
      )}

      {byRetention.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground" data-testid="footprint-retained">
          {byRetention.map((w) => (
            <li key={w.workspace_id}>
              <strong className="font-medium text-foreground">{w.name}</strong> {w.detail ?? 'holds retained records'} —
              kept for ten years, so it can&rsquo;t be deleted.
            </li>
          ))}
        </ul>
      )}

      {byMembers.length > 0 && (
        <p className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
          Other people are in {byMembers.map((w) => w.name).join(', ')}. Ownership must transfer
          first — deleting it would take their data with it.
        </p>
      )}

      {blocked ? (
        <p className="text-xs text-muted-foreground" data-testid="footprint-blocked">
          Nothing is deleted while any workspace above is held — the delete is all or nothing.
        </p>
      ) : willDelete.length === 0 ? null : (
        <Button variant="destructive" data-testid="delete-footprint" onClick={onDelete} disabled={remove.isPending}>
          <Trash2 size={15} />
          Delete my billing data
        </Button>
      )}
    </div>
  )
}

/** "This control exists, and it is over there." */
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
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
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

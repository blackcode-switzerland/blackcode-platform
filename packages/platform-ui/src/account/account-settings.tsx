'use client'

// Account settings — `/dashboard/settings/*` — one look in every app
// (2026-09-28): the tab strip and column (`AccountSettingsFrame`), and the
// sections every app has — Profile, Signed in, Password, API tokens,
// Appearance. Sections only one app has (sales' editing mode, books' language,
// an app's own "your data here") stay the app's, drawn inside the same
// `SettingsSection` card so they read as one page.
//
// Same contract as the workspace kit: presentational; every action is a
// callback that resolves on success and throws on failure (the app shows its
// own toast); every word is a label; the app passes its router's `Link`.

import { useEffect, useRef, useState } from 'react'
import { Check, Copy, ImageUp, KeyRound, Loader2, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { MemberAvatar } from '../ui/member-avatar'
import { useConfirm } from '../ui/confirm-dialog'
import { cn } from '../utils'
import { SettingsFieldList, SettingsSection } from '../workspace/workspace-settings'
import { withAccountDefaults, type AccountLabels } from './labels'

export { SettingsSection, SettingsFieldList }

// ---------------------------------------------------------------------------
// Frame and tabs
// ---------------------------------------------------------------------------

export interface AccountTab {
  href: string
  label: string
  active: boolean
  testId?: string
}

/** The tab strip and the `max-w-3xl` column every app's account settings sit in. */
export function AccountSettingsFrame({
  tabs,
  link: Link,
  bare,
  children,
}: {
  tabs: AccountTab[]
  link: React.ElementType
  /** True inside a shell whose content area already pads its pages. */
  bare?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn('mx-auto w-full max-w-3xl', !bare && 'px-4 py-6 sm:px-6')}>
      {/* The rule under the tabs is an inset shadow, not a border, and the tabs
          have no `-mb-px`: `overflow-x-auto` makes the strip scroll vertically
          too, so a tab poking 1px below it drew a vertical scrollbar wherever
          scrollbars are always shown (apps/issues styles them so). */}
      <nav
        className="mb-6 flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none]"
        aria-label="Settings"
        data-testid="settings-tabs"
      >
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            data-testid={t.testId}
            aria-current={t.active ? 'page' : undefined}
            className={cn(
              'shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              t.active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="space-y-6">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export interface ProfileData {
  name: string | null
  email: string
  tagline: string | null
  avatar_url: string | null
  /** False for a Google-connected account: its photo is synced from Google. */
  avatar_editable: boolean
  connected_google?: boolean
}

export function ProfileSection({
  me,
  onSave,
  photo,
  nameMax = 255,
  taglineMax = 140,
  labels,
}: {
  me: ProfileData
  onSave: (patch: { name: string | null; tagline: string | null }) => Promise<void>
  /** Upload / remove the photo. Always offered while `avatar_editable`. */
  photo: { onUpload: (file: File) => Promise<void>; onRemove: () => Promise<void> }
  nameMax?: number
  taglineMax?: number
  labels?: Partial<AccountLabels>
}) {
  const L = withAccountDefaults(labels)
  const [name, setName] = useState(me.name ?? '')
  const [tagline, setTagline] = useState(me.tagline ?? '')
  const [busy, setBusy] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  // Seed from the server once it answers, not on every refetch — a background
  // refetch must not overwrite what somebody is typing.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    setName(me.name ?? '')
    setTagline(me.tagline ?? '')
  }, [me.name, me.tagline])

  const dirty = name.trim() !== (me.name ?? '') || tagline.trim() !== (me.tagline ?? '')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!dirty || busy) return
    setBusy(true)
    try {
      await onSave({ name: name.trim() || null, tagline: tagline.trim() || null })
    } catch {
      // Shown by the app.
    } finally {
      setBusy(false)
    }
  }

  async function runPhoto(fn: () => Promise<void>) {
    setPhotoBusy(true)
    try {
      await fn()
    } catch {
      // Shown by the app.
    } finally {
      setPhotoBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <SettingsSection title={L.profileTitle} description={L.profileDescription} testId="settings-profile">
      <form onSubmit={save}>
        <SettingsFieldList
          items={[
            {
              label: L.photo,
              testId: 'profile-photo',
              value: (
                <div className="flex items-center gap-3">
                  <MemberAvatar name={me.name} email={me.email} avatarUrl={me.avatar_url} size={48} />
                  <div className="min-w-0">
                    {me.avatar_editable ? (
                      <>
                        <div className="flex flex-wrap gap-2">
                          <input
                            ref={input}
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            className="hidden"
                            data-testid="input-avatar"
                            onChange={(e) => {
                              const file = e.target.files?.[0]
                              if (file) void runPhoto(() => photo.onUpload(file))
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={photoBusy}
                            onClick={() => input.current?.click()}
                          >
                            {photoBusy ? <Loader2 className="animate-spin" /> : <ImageUp />}
                            {L.uploadPhoto}
                          </Button>
                          {me.avatar_url && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={photoBusy}
                              onClick={() => void runPhoto(photo.onRemove)}
                            >
                              {L.removePhoto}
                            </Button>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{L.photoHint}</p>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">{L.photoFromGoogle}</p>
                    )}
                  </div>
                </div>
              ),
            },
            {
              label: L.email,
              testId: 'profile-email',
              value: (
                <span>
                  {me.email}
                  <span className="block text-xs text-muted-foreground">
                    {me.connected_google ? L.signedInWithGoogle : L.signedInWithPassword}
                  </span>
                </span>
              ),
            },
            {
              label: L.name,
              value: (
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={nameMax}
                  placeholder={L.namePlaceholder}
                  aria-label={L.name}
                  className="max-w-md"
                  data-testid="input-profile-name"
                />
              ),
            },
            {
              label: L.tagline,
              value: (
                <div className="max-w-md">
                  <Input
                    value={tagline}
                    onChange={(e) => setTagline(e.target.value)}
                    maxLength={taglineMax}
                    aria-label={L.tagline}
                    data-testid="input-profile-tagline"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">{L.taglineHint}</p>
                </div>
              ),
            },
          ]}
        />
        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={!dirty || busy} data-testid="save-profile">
            {busy && <Loader2 className="animate-spin" />}
            {busy ? L.saving : L.save}
          </Button>
        </div>
      </form>
    </SettingsSection>
  )
}

// ---------------------------------------------------------------------------
// Signed in · Password
// ---------------------------------------------------------------------------

export function SignedInSection({
  email,
  onSignOut,
  labels,
}: {
  email: string
  onSignOut: () => void
  labels?: Partial<AccountLabels>
}) {
  const L = withAccountDefaults(labels)
  return (
    <SettingsSection title={L.signedInTitle} description={L.signedInDescription} testId="settings-signed-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm">{email}</span>
        <Button variant="outline" onClick={onSignOut} data-testid="settings-sign-out">
          <LogOut />
          {L.signOut}
        </Button>
      </div>
    </SettingsSection>
  )
}

/** The app's own password-reset flow (`children`), behind a button. */
export function PasswordSection({
  children,
  labels,
}: {
  /** Render the flow; call `close` when it finishes or is cancelled. */
  children: (close: () => void) => React.ReactNode
  labels?: Partial<AccountLabels>
}) {
  const L = withAccountDefaults(labels)
  const [open, setOpen] = useState(false)
  return (
    <SettingsSection title={L.passwordTitle} description={L.passwordDescription} testId="settings-password">
      {open ? (
        children(() => setOpen(false))
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)} data-testid="change-password">
          <KeyRound />
          {L.changePassword}
        </Button>
      )}
    </SettingsSection>
  )
}

// ---------------------------------------------------------------------------
// API tokens
// ---------------------------------------------------------------------------

export interface TokenRow {
  id: number
  name: string
  token_prefix: string
  last_used_at: string | null
  expires_at: string | null
  /** Shown when the route serves it (`GET /api/tokens` does). */
  created_at?: string | null
}

export function TokensSection({
  tokens,
  error,
  onCreate,
  onRevoke,
  onCopy,
  formatDate,
  footer,
  labels,
}: {
  tokens: TokenRow[] | undefined
  error?: React.ReactNode
  /** Resolve with the plaintext token, shown once. */
  onCreate: (name: string) => Promise<string>
  onRevoke: (token: TokenRow) => Promise<void>
  onCopy: (text: string) => void
  formatDate: (iso: string) => string
  footer?: React.ReactNode
  labels?: Partial<AccountLabels>
}) {
  const L = withAccountDefaults(labels)
  const { confirm } = useConfirm()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [minted, setMinted] = useState<string | null>(null)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      setMinted(await onCreate(name.trim()))
      setName('')
    } catch {
      // Shown by the app.
    } finally {
      setBusy(false)
    }
  }

  async function revoke(t: TokenRow) {
    const ok = await confirm({ title: L.revokeTitle(t.name), description: L.revokeDescription, confirmLabel: L.revoke, cancelLabel: L.cancel, destructive: true })
    if (!ok) return
    try {
      await onRevoke(t)
      // If the token just revoked is the one still on screen, take it off: a
      // secret shown after its row is gone invites somebody to paste a
      // credential that stopped working while they were reading it. The
      // plaintext starts with the prefix the list shows.
      setMinted((m) => (m && m.startsWith(`bk_live_${t.token_prefix}`) ? null : m))
    } catch {
      // Shown by the app.
    }
  }

  return (
    <>
      <SettingsSection title={L.newTokenTitle} description={L.newTokenDescription} testId="settings-new-token">
        {minted ? (
          <div className="space-y-3" data-testid="minted-token">
            <div>
              <p className="text-sm font-medium">{L.copyNowTitle}</p>
              <p className="text-xs text-muted-foreground">{L.copyNowDescription}</p>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2.5">
              <code className="min-w-0 flex-1 truncate font-mono text-xs">{minted}</code>
              <Button variant="outline" size="sm" onClick={() => onCopy(minted)}>
                <Copy size={13} />
                {L.copy}
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setMinted(null)}>
              <Check size={13} />
              {L.done}
            </Button>
          </div>
        ) : (
          <form onSubmit={create} className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={L.tokenNamePlaceholder}
              maxLength={100}
              data-testid="input-token-name"
            />
            <Button type="submit" disabled={!name.trim() || busy} data-testid="create-token">
              {busy && <Loader2 className="animate-spin" />}
              {busy ? L.creating : L.create}
            </Button>
          </form>
        )}
        {footer && <div className="mt-3 text-xs text-muted-foreground">{footer}</div>}
      </SettingsSection>

      <SettingsSection title={L.yourTokens} testId="settings-tokens">
        {error ??
          (!tokens ? (
            <Loader2 size={15} className="animate-spin text-muted-foreground" />
          ) : tokens.length === 0 ? (
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
              <KeyRound size={16} className="shrink-0" />
              <span>
                <span className="block text-foreground">{L.noTokens}</span>
                <span className="text-xs">{L.noTokensHint}</span>
              </span>
            </div>
          ) : (
            <ul className="divide-y divide-border" data-testid="token-list">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0" data-testid={`token-${t.id}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{t.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <code className="font-mono">bk_live_{t.token_prefix}…</code>
                      {t.created_at ? ` · ${L.created(formatDate(t.created_at))}` : ''}
                      {' · '}
                      {t.last_used_at ? L.lastUsed(formatDate(t.last_used_at)) : L.neverUsed}
                      {t.expires_at ? ` · ${L.expires(formatDate(t.expires_at))}` : ''}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void revoke(t)}
                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    data-testid={`revoke-token-${t.id}`}
                  >
                    {L.revoke}
                  </Button>
                </li>
              ))}
            </ul>
          ))}
      </SettingsSection>
    </>
  )
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

export function AppearanceSection({ labels }: { labels?: Partial<AccountLabels> }) {
  const L = withAccountDefaults(labels)
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const options = [
    { value: 'light', label: L.light, icon: Sun },
    { value: 'dark', label: L.dark, icon: Moon },
    { value: 'system', label: L.system, icon: Monitor },
  ] as const
  return (
    <SettingsSection title={L.appearanceTitle} description={L.appearanceDescription} testId="settings-appearance">
      <div className="grid grid-cols-3 gap-2 sm:max-w-md" role="radiogroup" aria-label={L.appearanceTitle}>
        {options.map((o) => {
          const active = mounted && theme === o.value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(o.value)}
              data-testid={`theme-${o.value}`}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-sm transition-colors',
                active ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:bg-accent'
              )}
            >
              <o.icon size={16} />
              {o.label}
            </button>
          )
        })}
      </div>
    </SettingsSection>
  )
}

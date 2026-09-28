'use client'

// The sections of a workspace's settings page — one set for every app
// (2026-09-28): General (name, slug, role, logo), Members, Invitations, Leave,
// and the Danger zone. Modelled on apps/billing's page, which had the most
// complete version; issues contributed the logo.
//
// ── WHAT IS SHARED AND WHAT IS NOT ─────────────────────────────────────────
// Shared: the layout, the words (`labels`), and the confirmation before every
// destructive action — remove, make owner, revoke, leave, and delete, which
// asks you to TYPE THE SLUG. The apps had drifted exactly there: sales removed
// members and revoked invitations with no confirmation at all, and issues
// confirmed delete by the workspace NAME.
//
// Not shared: fetching, mutating, toasts, navigation. Every action is a
// callback returning a promise; resolve when it worked, throw when it did not
// (the app shows its own error). Data props are `undefined` while loading, and
// `error` is a node the app renders in its own error style.
//
// The `footer` props are for each app's "same as `bk <app> …`" hint, which is
// app-specific by definition.

import { useRef, useState } from 'react'
import { Copy, Crown, ImageUp, Loader2, LogOut, Mail, Trash2, UserMinus, UserRound, X } from 'lucide-react'
import { useConfirm } from '../ui/confirm-dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { MemberAvatar } from '../ui/member-avatar'
import { cn } from '../utils'
import { WorkspaceMark } from './workspace-mark'
import { WORKSPACE_NAME_MAX } from './create-workspace-modal'
import { withDefaults, type WorkspaceLabels } from './labels'

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

export function SettingsSection({
  title,
  description,
  actions,
  children,
  tone,
  testId,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  tone?: 'danger'
  testId?: string
}) {
  return (
    <section
      data-testid={testId}
      className={cn(
        'overflow-hidden rounded-xl border bg-card text-card-foreground',
        tone === 'danger' ? 'border-destructive/30' : 'border-border'
      )}
    >
      <div
        className={cn(
          'flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3 sm:px-5',
          tone === 'danger' ? 'border-destructive/20 bg-destructive/5' : 'border-border'
        )}
      >
        <div className="min-w-0">
          <h2 className={cn('text-sm font-semibold', tone === 'danger' && 'text-destructive')}>{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  )
}

/** Label/value rows: stacked on a phone, two columns from `sm`. */
export function SettingsFieldList({
  items,
}: {
  items: Array<{ label: React.ReactNode; value: React.ReactNode; testId?: string; hidden?: boolean }>
}) {
  return (
    <dl className="divide-y divide-border">
      {items
        .filter((i) => !i.hidden)
        .map((i, n) => (
          <div key={n} className="grid gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[10rem_1fr] sm:gap-4">
            <dt className="text-xs text-muted-foreground sm:pt-1">{i.label}</dt>
            <dd className="min-w-0 break-words text-sm" data-testid={i.testId}>
              {i.value}
            </dd>
          </div>
        ))}
    </dl>
  )
}

function Loading() {
  return (
    <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
      <Loader2 size={15} className="animate-spin" />
    </div>
  )
}

const iconButton =
  'rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50'
const iconButtonDanger =
  'rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50'

// ---------------------------------------------------------------------------
// General — name, slug, role, logo
// ---------------------------------------------------------------------------

export function WorkspaceGeneralSection({
  workspace,
  role,
  canEdit,
  onRename,
  logo,
  labels,
}: {
  workspace: { name: string; slug: string; logo_url?: string | null }
  role: 'owner' | 'member'
  canEdit: boolean
  onRename: (name: string) => Promise<void>
  /** Supply to show the logo row. Omitted by an app that has no logo column. */
  logo?: { onUpload: (file: File) => Promise<void>; onRemove: () => Promise<void> }
  labels?: Partial<WorkspaceLabels>
}) {
  const L = withDefaults(labels)
  return (
    <SettingsSection title={L.general} testId="ws-general">
      <SettingsFieldList
        items={[
          {
            label: L.logo,
            value: <LogoField workspace={workspace} canEdit={canEdit} logo={logo} labels={L} />,
            testId: 'ws-logo',
            hidden: !logo && !workspace.logo_url,
          },
          {
            label: L.name,
            value: canEdit ? <RenameField current={workspace.name} onRename={onRename} labels={L} /> : workspace.name,
            testId: 'ws-name',
          },
          {
            label: L.slug,
            value: (
              <span>
                <code className="font-mono text-xs">{workspace.slug}</code>
                <span className="ml-2 text-xs text-muted-foreground">{L.slugFixed}</span>
              </span>
            ),
            testId: 'ws-slug',
          },
          { label: L.yourRole, value: role === 'owner' ? L.owner : L.member, testId: 'ws-role' },
        ]}
      />
      {!canEdit && <p className="mt-4 text-xs text-muted-foreground">{L.ownerOnly}</p>}
    </SettingsSection>
  )
}

function RenameField({
  current,
  onRename,
  labels: L,
}: {
  current: string
  onRename: (name: string) => Promise<void>
  labels: WorkspaceLabels
}) {
  const [name, setName] = useState(current)
  const [busy, setBusy] = useState(false)
  const trimmed = name.trim()
  const dirty = trimmed !== current && trimmed.length > 0

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!dirty || busy) return
    setBusy(true)
    try {
      await onRename(trimmed)
    } catch {
      // Shown by the app.
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="flex max-w-md gap-2" data-testid="rename-workspace-form">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={WORKSPACE_NAME_MAX}
        aria-label={L.nameLabel}
        data-testid="input-rename-workspace"
      />
      <Button type="submit" variant="outline" disabled={!dirty || busy} data-testid="save-rename-workspace">
        {busy ? L.saving : L.save}
      </Button>
    </form>
  )
}

function LogoField({
  workspace,
  canEdit,
  logo,
  labels: L,
}: {
  workspace: { name: string; logo_url?: string | null }
  canEdit: boolean
  logo?: { onUpload: (file: File) => Promise<void>; onRemove: () => Promise<void> }
  labels: WorkspaceLabels
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } catch {
      // Shown by the app.
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="flex items-center gap-3">
      <WorkspaceMark name={workspace.name} logoUrl={workspace.logo_url} size={40} />
      {canEdit && logo && (
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              data-testid="input-workspace-logo"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void run(() => logo.onUpload(file))
              }}
            />
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? <Loader2 className="animate-spin" /> : <ImageUp />}
              {L.uploadLogo}
            </Button>
            {workspace.logo_url && (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run(logo.onRemove)}>
                {L.removeLogo}
              </Button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{L.logoHint}</p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export interface SettingsMember {
  user_id: number
  name: string | null
  email: string
  avatar_url?: string | null
  role: string
  deleted_at?: string | Date | null
}

export function WorkspaceMembersSection({
  members,
  error,
  currentUserId,
  ownerId,
  isOwner,
  onTransfer,
  onRemove,
  footer,
  labels,
}: {
  members: SettingsMember[] | undefined
  error?: React.ReactNode
  currentUserId: number
  ownerId: number
  isOwner: boolean
  onTransfer: (m: SettingsMember) => Promise<void>
  onRemove: (m: SettingsMember) => Promise<void>
  footer?: React.ReactNode
  labels?: Partial<WorkspaceLabels>
}) {
  const L = withDefaults(labels)
  const { confirm } = useConfirm()
  const [busy, setBusy] = useState<number | null>(null)

  async function act(m: SettingsMember, kind: 'transfer' | 'remove') {
    const who = m.name ?? m.email
    const ok = await confirm(
      kind === 'transfer'
        ? { title: L.transferTitle(who), description: L.transferDescription, confirmLabel: L.transferConfirm, destructive: true }
        : { title: L.removeTitle(who), description: L.removeDescription, confirmLabel: L.removeConfirm, destructive: true }
    )
    if (!ok) return
    setBusy(m.user_id)
    try {
      await (kind === 'transfer' ? onTransfer(m) : onRemove(m))
    } catch {
      // Shown by the app.
    } finally {
      setBusy(null)
    }
  }

  return (
    <SettingsSection
      title={L.members}
      actions={members ? <span className="text-xs tabular-nums text-muted-foreground">{members.length}</span> : undefined}
      testId="ws-members"
    >
      {error ?? (!members ? (
        <Loading />
      ) : (
        <ul className="divide-y divide-border">
          {members.map((m) => {
            const who = m.name ?? m.email
            const isOwnerRow = m.user_id === ownerId
            const canManage = isOwner && !isOwnerRow
            return (
              <li key={m.user_id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0" data-testid={`member-${m.user_id}`}>
                <MemberAvatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">
                    {who}
                    {m.user_id === currentUserId && <span className="ml-1.5 text-xs text-muted-foreground">{L.you}</span>}
                    {m.deleted_at && <span className="ml-1.5 text-xs text-muted-foreground">{L.accountClosed}</span>}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
                </span>
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
                    isOwnerRow ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border text-muted-foreground'
                  )}
                >
                  {isOwnerRow && <Crown size={11} />}
                  {isOwnerRow ? L.owner : L.member}
                </span>
                {canManage && (
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => act(m, 'transfer')}
                      disabled={busy !== null}
                      aria-label={L.makeOwnerAria(who)}
                      title={L.makeOwner}
                      data-testid={`transfer-to-${m.user_id}`}
                      className={iconButton}
                    >
                      <Crown size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => act(m, 'remove')}
                      disabled={busy !== null}
                      aria-label={L.removeMemberAria(who)}
                      title={L.removeMember}
                      data-testid={`remove-member-${m.user_id}`}
                      className={iconButtonDanger}
                    >
                      {busy === m.user_id ? <Loader2 size={15} className="animate-spin" /> : <UserMinus size={15} />}
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      ))}
      {footer && <div className="mt-4 text-xs text-muted-foreground">{footer}</div>}
    </SettingsSection>
  )
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export interface SettingsInvitation {
  id: number
  email: string
  token: string
  invited_by_name?: string | null
  invited_by_email?: string | null
  expires_at?: string | Date | null
}

export interface SettingsCandidate {
  user_id: number
  email: string
  name: string | null
  avatar_url?: string | null
  already_member: boolean
  invited: boolean
  from_platform: boolean
}

export function WorkspaceInvitationsSection({
  invitations,
  error,
  candidates,
  onInvite,
  onRevoke,
  onCopy,
  inviteLink,
  footer,
  formatDate,
  labels,
}: {
  invitations: SettingsInvitation[] | undefined
  error?: React.ReactNode
  candidates?: SettingsCandidate[]
  /** Resolve with the accept link (always returned by the route) to show it. */
  onInvite: (email: string) => Promise<string | null | void>
  onRevoke: (inv: SettingsInvitation) => Promise<void>
  /** Copy text and say so — the app owns the toast. */
  onCopy: (text: string) => void
  /** The accept URL for a pending invitation; defaults to this origin's `/invitations/{token}`. */
  inviteLink?: (inv: SettingsInvitation) => string
  footer?: React.ReactNode
  formatDate?: (d: string | Date) => string
  labels?: Partial<WorkspaceLabels>
}) {
  const L = withDefaults(labels)
  const { confirm } = useConfirm()
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [lastLink, setLastLink] = useState<string | null>(null)

  const colleagues = (candidates ?? []).filter((c) => !c.from_platform && !c.already_member && !c.invited)
  const linkFor = inviteLink ?? ((inv: SettingsInvitation) => `${window.location.origin}/invitations/${inv.token}`)

  async function invite(address: string) {
    const value = address.trim().toLowerCase()
    if (!value || sending) return
    setSending(true)
    try {
      const link = await onInvite(value)
      setEmail('')
      if (link) setLastLink(link)
    } catch {
      // Shown by the app.
    } finally {
      setSending(false)
    }
  }

  async function revoke(inv: SettingsInvitation) {
    const ok = await confirm({
      title: L.revokeTitle(inv.email),
      description: L.revokeDescription,
      confirmLabel: L.revokeConfirm,
      destructive: true,
    })
    if (!ok) return
    try {
      await onRevoke(inv)
    } catch {
      // Shown by the app.
    }
  }

  return (
    <SettingsSection title={L.invitations} description={L.invitationsDescription} testId="ws-invitations">
      <div className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void invite(email)
          }}
        >
          <Input
            type="email"
            data-testid="input-invite-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={L.inviteEmailPlaceholder}
            list="workspace-invite-candidates"
          />
          <datalist id="workspace-invite-candidates">
            {(candidates ?? [])
              .filter((c) => !c.already_member && !c.invited)
              .map((c) => (
                <option key={c.user_id} value={c.email}>
                  {c.name ?? c.email}
                </option>
              ))}
          </datalist>
          <Button type="submit" disabled={!email.trim() || sending} data-testid="send-invite">
            {sending ? <Loader2 className="animate-spin" /> : <Mail />}
            {sending ? L.inviting : L.invite}
          </Button>
        </form>

        {colleagues.length > 0 && (
          <div data-testid="invite-candidates">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{L.colleagues}</p>
            <ul className="flex flex-wrap gap-1.5">
              {colleagues.map((c) => (
                <li key={c.user_id}>
                  <button
                    type="button"
                    onClick={() => void invite(c.email)}
                    disabled={sending}
                    data-testid={`invite-candidate-${c.user_id}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                  >
                    <MemberAvatar name={c.name} email={c.email} avatarUrl={c.avatar_url} size={16} />
                    {c.name ?? c.email}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {lastLink && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2.5">
            <code className="min-w-0 flex-1 truncate font-mono text-xs" data-testid="last-invite-link">
              {lastLink}
            </code>
            <Button variant="outline" size="sm" onClick={() => onCopy(lastLink)}>
              <Copy size={13} />
              {L.copy}
            </Button>
          </div>
        )}

        {error ?? (!invitations ? (
          <Loading />
        ) : invitations.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
            <UserRound size={16} className="shrink-0" />
            <span>
              <span className="block text-foreground">{L.noInvitations}</span>
              <span className="text-xs">{L.noInvitationsHint}</span>
            </span>
          </div>
        ) : (
          <ul className="divide-y divide-border" data-testid="invitation-list">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 py-2.5" data-testid={`invitation-${inv.id}`}>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
                  <Mail size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{inv.email}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {L.invitedBy(inv.invited_by_name ?? inv.invited_by_email ?? '—')}
                    {inv.expires_at && formatDate && ` · ${L.expires(formatDate(inv.expires_at))}`}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onCopy(linkFor(inv))}
                  aria-label={L.copyLinkAria(inv.email)}
                  data-testid={`copy-invitation-${inv.id}`}
                  className={iconButton}
                >
                  <Copy size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => void revoke(inv)}
                  aria-label={L.revokeAria(inv.email)}
                  data-testid={`revoke-invitation-${inv.id}`}
                  className={iconButtonDanger}
                >
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        ))}

        {footer && <div className="text-xs text-muted-foreground">{footer}</div>}
      </div>
    </SettingsSection>
  )
}

// ---------------------------------------------------------------------------
// Leave — a member's way out
// ---------------------------------------------------------------------------

export function WorkspaceLeaveSection({
  name,
  onLeave,
  detail,
  footer,
  labels,
}: {
  name: string
  onLeave: () => Promise<void>
  /** Overrides `labels.leaveDetail` with the app's own nouns. */
  detail?: React.ReactNode
  footer?: React.ReactNode
  labels?: Partial<WorkspaceLabels>
}) {
  const L = withDefaults(labels)
  const { confirm } = useConfirm()
  const [busy, setBusy] = useState(false)

  async function leave() {
    const ok = await confirm({
      title: L.leaveTitle(name),
      description: L.leaveDescription,
      confirmLabel: L.leaveWorkspace,
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await onLeave()
    } catch {
      // Shown by the app.
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection title={L.leaveWorkspace} testId="ws-leave">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-lg text-sm text-muted-foreground">
          <p>{detail ?? L.leaveDetail}</p>
          {footer && <div className="mt-1 text-xs">{footer}</div>}
        </div>
        <Button variant="outline" onClick={() => void leave()} disabled={busy} data-testid="leave-workspace">
          {busy ? <Loader2 className="animate-spin" /> : <LogOut />}
          {L.leaveWorkspace}
        </Button>
      </div>
    </SettingsSection>
  )
}

// ---------------------------------------------------------------------------
// Danger zone — delete, typed-slug confirmation, or the reason it is refused
// ---------------------------------------------------------------------------

export function WorkspaceDangerSection({
  name,
  slug,
  refusal,
  onDelete,
  detail,
  footer,
  labels,
}: {
  name: string
  slug: string
  /**
   * Why this workspace can never be deleted, when the app knows — rendered
   * INSTEAD of the button, so an owner looking for "delete" learns why there
   * is none rather than concluding it is missing. `undefined` while the app is
   * still finding out (renders a spinner); `null` when deletable.
   */
  refusal?: React.ReactNode | null
  onDelete: () => Promise<void>
  detail?: React.ReactNode
  footer?: React.ReactNode
  labels?: Partial<WorkspaceLabels>
}) {
  const L = withDefaults(labels)
  const { prompt } = useConfirm()
  const [busy, setBusy] = useState(false)

  async function del() {
    const typed = await prompt({
      title: L.deleteTitle(name),
      description: L.deleteDescription(slug),
      confirmLabel: L.deleteWorkspace,
      destructive: true,
      inputLabel: L.deleteInputLabel,
      placeholder: slug,
      requireMatch: slug,
    })
    if (typed === null) return
    setBusy(true)
    try {
      await onDelete()
    } catch {
      // Shown by the app.
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection title={L.dangerZone} tone="danger" testId="ws-danger-zone">
      {refusal === undefined ? (
        <Loading />
      ) : refusal ? (
        <div className="text-sm text-muted-foreground" data-testid="ws-delete-refused">
          {refusal}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-lg text-sm text-muted-foreground">
            <p>{detail ?? L.deleteDetail}</p>
            {footer && <div className="mt-1 text-xs">{footer}</div>}
          </div>
          <Button variant="destructive" onClick={() => void del()} disabled={busy} data-testid="delete-workspace">
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
            {L.deleteWorkspace}
          </Button>
        </div>
      )}
    </SettingsSection>
  )
}

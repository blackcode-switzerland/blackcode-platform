'use client'

// Workspace settings — `/dashboard/{ws}/settings`. Since 2026-09-28, the
// sections every blackcode app shares (`@blackcode/platform-ui/workspace/
// workspace-settings`), wired to this app's routes:
//
//   logo              POST / DELETE /api/workspaces/{ws}/logo      workspace logo <file> | --remove
//   rename            PATCH  /api/workspaces/{ws}                workspace edit --name
//   make owner        POST   …/transfer                          workspace transfer --to <id>
//   remove            DELETE …/members/{userId}                  member remove <id>
//   leave             POST   …/leave                             member leave
//   invite / revoke   POST / DELETE …/invitations                invite send | revoke
//   delete            DELETE /api/workspaces/{ws}                workspace delete <slug> --confirm <slug>
//
// It replaces three pages: `/dashboard/workspaces/{slug}` (settings, outside the
// workspace), `/dashboard/{ws}/members` and `/dashboard/{ws}/members/invite`,
// which all redirect here now. On the way, revoking an invitation gained its
// confirmation, delete asks for the SLUG (it asked for the name), and a member
// can finally leave — the route existed and no button called it.

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HardDrive } from 'lucide-react'
import {
  SettingsSection,
  WorkspaceDangerSection,
  WorkspaceGeneralSection,
  WorkspaceInvitationsSection,
  WorkspaceLeaveSection,
  WorkspaceMembersSection,
  type SettingsCandidate,
  type SettingsInvitation,
  type SettingsMember,
} from '@blackcode/platform-ui/workspace/workspace-settings'

const LOGO_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const LOGO_MAX_BYTES = 5 * 1024 * 1024

interface WorkspaceRow {
  id: number
  name: string
  slug: string
  logo_url: string | null
  owner_id: number
  member_role: 'owner' | 'member'
}

/** A write, with the server's error as a toast and a throw — so the shared section knows it failed. */
async function send<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = j.error ?? j.message ?? 'Something went wrong'
    toast.error(message, { description: j.suggestion })
    throw new Error(message)
  }
  return j as T
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} failed`)
  return res.json()
}

function Cmd({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{children}</code>
}

export function WorkspaceSettings({ slug }: { slug: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data: ws } = useQuery({
    queryKey: ['workspace', slug],
    queryFn: async () =>
      ((await get<{ data: WorkspaceRow[] }>('/api/workspaces')).data.find((w) => w.slug === slug) ?? null),
  })
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => get<{ id: number }>('/api/me') })
  const isOwner = ws?.member_role === 'owner'

  const members = useQuery({
    queryKey: ['workspace-members', slug],
    queryFn: async () => (await get<{ data: SettingsMember[] }>(`/api/workspaces/${slug}/members`)).data,
  })
  const invitations = useQuery({
    queryKey: ['workspace-invitations', slug],
    enabled: isOwner,
    queryFn: async () => (await get<{ data: SettingsInvitation[] }>(`/api/workspaces/${slug}/invitations`)).data,
  })
  const candidates = useQuery({
    queryKey: ['invite-candidates', slug],
    enabled: isOwner,
    queryFn: async () => (await get<{ data: SettingsCandidate[] }>(`/api/workspaces/${slug}/invite-candidates`)).data,
  })

  if (!ws || !me) return null

  const refreshAll = async () => {
    await queryClient.invalidateQueries()
    router.refresh()
  }
  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast.success('Invite link copied'),
      () => toast.error('Could not copy — select the link and copy it by hand')
    )

  return (
    <div className="space-y-6">
      <WorkspaceGeneralSection
        workspace={ws}
        role={ws.member_role}
        canEdit={isOwner}
        onRename={async (name) => {
          await send('PATCH', `/api/workspaces/${slug}`, { name })
          toast.success('Workspace updated')
          await refreshAll()
        }}
        logo={{
          onUpload: async (file) => {
            if (!LOGO_TYPES.includes(file.type)) {
              toast.error('Please choose a JPG, PNG, GIF, or WebP image')
              throw new Error('bad type')
            }
            if (file.size > LOGO_MAX_BYTES) {
              toast.error('Image must be 5MB or smaller')
              throw new Error('too big')
            }
            const fd = new FormData()
            fd.append('file', file)
            const res = await fetch(`/api/workspaces/${slug}/logo`, { method: 'POST', body: fd })
            const j = await res.json().catch(() => ({}))
            if (!res.ok) {
              toast.error(j.error ?? 'Upload failed', { description: j.suggestion })
              throw new Error('upload failed')
            }
            toast.success('Logo updated')
            await refreshAll()
          },
          onRemove: async () => {
            await send('DELETE', `/api/workspaces/${slug}/logo`)
            toast.success('Logo removed')
            await refreshAll()
          },
        }}
      />

      <WorkspaceMembersSection
        members={members.data}
        currentUserId={me.id}
        ownerId={ws.owner_id}
        isOwner={isOwner}
        onTransfer={async (m) => {
          await send('POST', `/api/workspaces/${slug}/transfer`, { new_owner_user_id: m.user_id })
          toast.success(`${m.name ?? m.email} is now the owner`)
          await refreshAll()
        }}
        onRemove={async (m) => {
          await send('DELETE', `/api/workspaces/${slug}/members/${m.user_id}`)
          toast.success(`${m.name ?? m.email} removed`)
          await queryClient.invalidateQueries({ queryKey: ['workspace-members', slug] })
        }}
        footer={
          <>
            Same as <Cmd>bk issues member list</Cmd>, <Cmd>bk issues member remove &lt;user_id&gt;</Cmd> and{' '}
            <Cmd>bk issues workspace transfer --to &lt;user_id&gt;</Cmd>.
          </>
        }
      />

      {isOwner && (
        <WorkspaceInvitationsSection
          invitations={invitations.data}
          candidates={candidates.data}
          labels={{ colleagues: 'People from your other workspaces' }}
          formatDate={(d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          onCopy={copy}
          onInvite={async (email) => {
            const res = await send<{ invitation: { token: string }; email_sent?: boolean }>(
              'POST',
              `/api/workspaces/${slug}/invitations`,
              { email }
            )
            if (res.email_sent) toast.success(`Invitation emailed to ${email}`)
            else
              toast.success(`Invitation created for ${email}`, {
                description: 'The email could not be sent from here — copy the link below and send it yourself.',
              })
            await queryClient.invalidateQueries({ queryKey: ['workspace-invitations', slug] })
            await queryClient.invalidateQueries({ queryKey: ['invite-candidates', slug] })
            return `${window.location.origin}/invitations/${res.invitation.token}`
          }}
          onRevoke={async (inv) => {
            await send('DELETE', `/api/workspaces/${slug}/invitations/${inv.id}`)
            toast.success('Invitation revoked')
            await queryClient.invalidateQueries({ queryKey: ['workspace-invitations', slug] })
          }}
          footer={
            <>
              Same as <Cmd>bk issues invite send &lt;email&gt;</Cmd>. The invitee accepts on the link, in their
              inbox, or with <Cmd>bk issues invite accept &lt;token&gt;</Cmd>.
            </>
          }
        />
      )}

      {isOwner && (
        <SettingsSection title="Storage" description="Every file uploaded in this workspace, and what still references it.">
          <Link
            href={`/dashboard/workspaces/${encodeURIComponent(slug)}/storage`}
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <HardDrive size={15} />
            Open storage
          </Link>
        </SettingsSection>
      )}

      {isOwner ? (
        <WorkspaceDangerSection
          name={ws.name}
          slug={ws.slug}
          refusal={null}
          detail="This permanently deletes the workspace and everything in it — projects, tasks, issues and their files."
          onDelete={async () => {
            await send('DELETE', `/api/workspaces/${slug}`)
            toast.success(`${ws.name} deleted`)
            await queryClient.invalidateQueries()
            router.push('/dashboard')
            router.refresh()
          }}
          footer={
            <>
              Same as <Cmd>bk issues workspace delete {ws.slug} --confirm {ws.slug}</Cmd>.
            </>
          }
        />
      ) : (
        <WorkspaceLeaveSection
          name={ws.name}
          onLeave={async () => {
            await send('POST', `/api/workspaces/${slug}/leave`)
            toast.success(`You left ${ws.name}`)
            await queryClient.invalidateQueries()
            router.push('/dashboard')
            router.refresh()
          }}
          footer={
            <>
              Same as <Cmd>bk issues member leave</Cmd>.
            </>
          }
        />
      )}
    </div>
  )
}

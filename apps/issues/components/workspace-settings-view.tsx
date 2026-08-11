'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, Crown, HardDrive, Loader2, Save, Trash2, Upload } from 'lucide-react'
import { useConfirm } from '@blackcode/platform-ui/ui/confirm-dialog'
import { avatarColor } from '@blackcode/platform-ui/ui/member-avatar'

const ACCEPTED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024

interface Workspace {
  id: number
  name: string
  slug: string
  logo_url: string | null
  owner_id: number
  member_role: 'owner' | 'member'
}

interface Member {
  user_id: number
  email: string
  name: string | null
  role: 'owner' | 'member'
}

// Resolve the workspace to manage. When `slug` is given we look that specific
// workspace up (so any workspace can be managed from /dashboard/workspaces/[slug]);
// otherwise we fall back to the user's active workspace.
async function fetchWorkspace(slug?: string): Promise<Workspace | null> {
  const wsRes = await fetch('/api/workspaces')
  if (!wsRes.ok) return null
  const { data } = await wsRes.json()
  const all = data as Workspace[]
  if (slug) return all.find((w) => w.slug === slug) ?? null
  const meRes = await fetch('/api/me')
  if (!meRes.ok) return null
  const me = await meRes.json()
  if (!me.active_workspace_id) return null
  return all.find((w) => w.id === me.active_workspace_id) ?? null
}

export function WorkspaceSettingsView({ slug, backHref }: { slug?: string; backHref?: string } = {}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm, prompt } = useConfirm()
  const { data: ws } = useQuery({
    queryKey: slug ? ['workspace', slug] : ['active-workspace'],
    queryFn: () => fetchWorkspace(slug),
  })
  const logoFileRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [logoUploading, setLogoUploading] = useState(false)
  const [savedName, setSavedName] = useState('')

  useEffect(() => {
    if (ws) {
      setName(ws.name)
      setLogoUrl(ws.logo_url ?? '')
      setSavedName(ws.name)
    }
  }, [ws])

  const isDirty = name !== savedName

  const { data: members } = useQuery({
    queryKey: ['workspace-members', ws?.slug],
    enabled: !!ws,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/members`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data as Member[]
    },
  })

  const save = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Workspace updated')
      setSavedName(name)
      queryClient.invalidateQueries({ queryKey: ['active-workspace'] })
      if (slug) queryClient.invalidateQueries({ queryKey: ['workspace', slug] })
      queryClient.invalidateQueries({ queryKey: ['me-workspaces'] })
      router.refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const transfer = useMutation({
    mutationFn: async (newOwnerId: number) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_owner_user_id: newOwnerId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'failed')
      }
    },
    onSuccess: () => {
      toast.success('Ownership transferred')
      queryClient.invalidateQueries()
      router.refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'failed')
      }
    },
    onSuccess: () => {
      toast.success('Workspace deleted')
      queryClient.invalidateQueries()
      router.push(backHref ?? '/dashboard')
      router.refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!ACCEPTED.includes(file.type)) {
      toast.error('Please choose a JPG, PNG, GIF, or WebP image')
      return
    }
    if (file.size > MAX_BYTES) {
      toast.error('Image must be 5MB or smaller')
      return
    }
    setLogoUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.url) throw new Error(j.error ?? 'Upload failed')
      setLogoUrl(j.url)
      save.mutate({ name, logo_url: j.url })
      toast.success('Logo updated')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLogoUploading(false)
    }
  }

  if (!ws) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">No active workspace.</p>
      </div>
    )
  }

  const isOwner = ws.member_role === 'owner'
  const otherMembers = (members ?? []).filter((m) => m.user_id !== ws.owner_id)

  return (
    <div>
      <header className="mb-8">
        {backHref ? (
          <Link
            href={backHref}
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={14} />
            All workspaces
          </Link>
        ) : null}
        <h1 className="text-xl font-semibold">{ws.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isOwner ? `You own ${ws.name}.` : `You are a member of ${ws.name}.`}
        </p>
      </header>

      <section className="mb-8">
        <div className="space-y-6">
          {/* Logo — always first, saves immediately on upload */}
          {isOwner ? (
            <Field label="Logo" hint="Optional. Square image. JPG, PNG, GIF, or WebP. Max 5MB.">
              <div className="flex items-center gap-3">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="Workspace logo" className="size-10 shrink-0 rounded-md object-cover" />
                ) : (
                  <div
                    className="flex size-10 shrink-0 items-center justify-center rounded-md text-[15px] font-semibold text-white"
                    style={{ backgroundColor: avatarColor(ws.name) }}
                  >
                    {(ws.name[0] ?? 'W').toUpperCase()}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={logoFileRef}
                    type="file"
                    accept={ACCEPTED.join(',')}
                    onChange={onPickLogo}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => logoFileRef.current?.click()}
                    disabled={logoUploading || save.isPending}
                    className="cursor-pointer inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary disabled:opacity-50"
                  >
                    {logoUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                    {logoUrl ? 'Change logo' : 'Upload logo'}
                  </button>
                  {logoUrl ? (
                    <button
                      type="button"
                      onClick={() => {
                        setLogoUrl('')
                        save.mutate({ name, logo_url: null })
                      }}
                      disabled={save.isPending}
                      className="cursor-pointer inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-50"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            </Field>
          ) : null}
          <Field label="Name" hint="Displayed across the app." disabled={!isOwner}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              disabled={!isOwner}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            />
          </Field>
          {isOwner && isDirty ? (
            <div className="flex justify-end">
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => {
                  save.mutate({ name, logo_url: logoUrl || null })
                }}
                className="cursor-pointer flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Save size={14} />
                Save changes
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {isOwner ? (
        <section className="mb-8 border-t border-border pt-8">
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
            <HardDrive size={15} />
            Storage
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Review all files uploaded into this workspace, see what references each one, and delete
            unused files to free space.
          </p>
          <Link
            href={`/dashboard/workspaces/${ws.slug}/storage`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary"
          >
            <HardDrive size={14} />
            Manage storage
          </Link>
        </section>
      ) : null}

      {isOwner && otherMembers.length > 0 ? (
        <section className="mb-8 border-t border-border pt-8">
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
            <Crown size={15} className="text-amber-400" />
            Transfer ownership
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            The current owner will become a regular member after transfer.
          </p>
          <select
            onChange={async (e) => {
              const v = parseInt(e.target.value)
              e.currentTarget.value = ''
              if (Number.isNaN(v)) return
              if (
                !(await confirm({
                  title: 'Transfer ownership?',
                  description: 'This cannot be undone without the new owner cooperating.',
                  destructive: true,
                  confirmLabel: 'Transfer',
                }))
              )
                return
              transfer.mutate(v)
            }}
            defaultValue=""
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Pick a new owner…
            </option>
            {otherMembers.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name ?? m.email}
              </option>
            ))}
          </select>
        </section>
      ) : null}

      {isOwner ? (
        <section className="border-t border-destructive/20 pt-8">
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-destructive">
            <AlertTriangle size={15} />
            Danger zone
          </h2>
          <p className="mb-5 text-sm text-muted-foreground">
            Deleting a workspace permanently removes all its projects, tasks, issues, comments, attachments, labels,
            members, and history. This cannot be undone.
          </p>
          <div className="flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Delete workspace</p>
              <p className="text-sm text-muted-foreground">Permanently delete {ws.name} and all its data</p>
            </div>
            <button
              onClick={async () => {
                const typed = await prompt({
                  title: 'Delete workspace?',
                  description:
                    'This permanently deletes the workspace and all its data. This cannot be undone.',
                  inputLabel: `Type "${ws.name}" to confirm`,
                  placeholder: ws.name,
                  requireMatch: ws.name,
                  destructive: true,
                  confirmLabel: 'Delete workspace',
                })
                if (typed == null) return
                if (typed === ws.name) remove.mutate()
              }}
              className="cursor-pointer flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground"
            >
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        </section>
      ) : null}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
  disabled,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label className={`block text-sm font-medium ${disabled ? 'text-muted-foreground' : ''}`}>
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

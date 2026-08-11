'use client'

// Your name and tagline — `platform.users`, the same row every blackcode app
// reads. The page says so, because a Settings screen inside one app reads as
// that app's settings and this one is not.
//
// It writes through `apiSend`, not through `lib/mutations.ts`, and **it is not
// behind `ui_mode`**. `read_only` hides editing of the sales PIPELINE; a display
// preference that also stopped somebody changing their own name would have
// become a permission over the account, which is the misreading D-7 exists to
// prevent. `lib/read-only.test.ts` allows this call site by name and asserts the
// path it uses is not an `/api/workspaces/…` one.

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { MemberAvatar } from '@blackcode/platform-ui/ui/member-avatar'
import { apiGet, apiSend } from '@/lib/client'
import { BlockSkeleton, ErrorState } from '@/components/states'

/**
 * The image types the picker offers.
 *
 * A COURTESY, not the rule. The server's cap on size and its blocked-MIME list
 * are enforced in `POST /api/upload` and served by `GET /api/meta`; this list
 * only stops the file chooser offering a `.zip` and only narrows what the real
 * check would accept anyway. No byte cap is typed here on purpose — that number
 * is declared once and a second copy on a settings page is a second copy to go
 * stale. An oversized file gets the server's own message through the toast.
 */
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

interface Me {
  id: number
  email: string
  name: string | null
  tagline: string | null
  avatar_url: string | null
  connected_google: boolean
  avatar_editable: boolean
  is_super_admin: boolean
}

export function ProfileSettings() {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: () => apiGet<Me>('/api/me') })

  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Seeded ONCE. Re-seeding on every render of fresh data would overwrite what
  // somebody is typing the moment a background refetch lands.
  useEffect(() => {
    if (me.data && !loaded) {
      setName(me.data.name ?? '')
      setTagline(me.data.tagline ?? '')
      setLoaded(true)
    }
  }, [me.data, loaded])

  const save = useMutation({
    mutationFn: () =>
      apiSend<Me>('PATCH', '/api/me', {
        name: name.trim() || null,
        tagline: tagline.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] })
      toast.success('Profile updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const setAvatar = useMutation({
    mutationFn: (avatar_url: string | null) => apiSend<Me>('PATCH', '/api/me', { avatar_url }),
    onSuccess: () => {
      // One invalidation reaches both this page and the sidebar: `sales-shell`
      // draws from `useMe()`, the same `['me']` query, precisely so that a photo
      // changed here appears there without a reload. `update()` on the next-auth
      // session was tried first and did NOT work — this app's `jwt` callback
      // only refreshes on sign-in, so the session's `image` is whatever it was
      // then. Measured, not assumed.
      qc.invalidateQueries({ queryKey: ['me'] })
      toast.success('Photo updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // so picking the same file twice still fires
    if (!file) return
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      // Through `apiSend`, NOT a bare `fetch` — `lib/read-only.test.ts` asserts
      // there is exactly one `fetch(` in this app, and it caught the first
      // version of this function calling `fetch` here. The transport grew a
      // FormData branch instead; the ApiClientError it throws already carries
      // the server's own message and `suggestion`, which is the half that knows
      // the real size cap and the real blocked types.
      const { url } = await apiSend<{ url: string }>('POST', '/api/upload', body)
      if (!url) throw new Error('Upload succeeded but returned no URL')
      await setAvatar.mutateAsync(url)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  if (me.isPending) return <BlockSkeleton rows={3} />
  if (me.error) return <ErrorState error={me.error} />

  return (
    <div className="space-y-6">
      <Section
        title="Your blackcode profile"
        note="This is your account, not a b/sales one. The name here is the name every blackcode app shows."
      >
        {/* ── THE PHOTO, WHICH THIS PAGE FETCHED AND NEVER SHOWED ───────────
            `avatar_url` and `avatar_editable` were already in the `Me` interface
            and already arriving from `GET /api/me` — nothing rendered either.
            So a b/sales user had no way to set the photo that the members list
            shows, and (from 2026-08-11) the sidebar shows too: they had to go to
            `apps/issues` to change a field on the account both apps share, which
            is precisely the errand `packages/platform-email` was extracted to
            end for passwords.
            `PATCH /api/me` accepts `avatar_url` and `POST /api/upload` is
            mounted here; no route changed for this. */}
        <Field label="Photo">
          <div className="flex items-center gap-4">
            <MemberAvatar
              name={me.data.name}
              email={me.data.email}
              avatarUrl={me.data.avatar_url}
              size={56}
            />
            {me.data.avatar_editable === false ? (
              <p className="text-xs text-muted-foreground">
                Synced from your Google account, so it is changed there rather
                than here.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept={AVATAR_TYPES.join(',')}
                  onChange={onPickPhoto}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading || setAvatar.isPending}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
                >
                  {uploading ? 'Uploading…' : me.data.avatar_url ? 'Change photo' : 'Upload photo'}
                </button>
                {me.data.avatar_url && (
                  <button
                    type="button"
                    onClick={() => setAvatar.mutate(null)}
                    disabled={uploading || setAvatar.isPending}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
                <p className="w-full text-xs text-muted-foreground">
                  A square image reads best. Without one you get your initials,
                  in a colour derived from your name.
                </p>
              </div>
            )}
          </div>
        </Field>

        <Field label="Email">
          <p className="text-sm text-foreground">{me.data.email}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {me.data.connected_google
              ? 'Signed in with Google. Your photo is synced from there.'
              : 'Signed in with a password.'}
          </p>
        </Field>

        <Field label="Name" htmlFor="name">
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
          />
        </Field>

        <Field label="Tagline" htmlFor="tagline">
          <input
            id="tagline"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="What you do here"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
          />
        </Field>

        <div className="flex justify-end">
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </Section>
    </div>
  )
}

export function Section({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card/40 p-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

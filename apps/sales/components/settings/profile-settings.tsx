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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ProfileSection, SettingsSection } from '@blackcode/platform-ui/account/account-settings'
import { apiGet, apiSend } from '@/lib/client'
import { BlockSkeleton, ErrorState } from '@/components/states'

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

/**
 * Profile — the shared `ProfileSection` (2026-09-28): photo, email and how you
 * sign in, name, tagline. `PATCH /api/me` for the text; the photo goes through
 * `POST/DELETE /api/me/avatar` (`meAvatarRoute`) now, not `/api/upload` +
 * `PATCH` — one request, and a file the blob index protects.
 */
export function ProfileSettings() {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: () => apiGet<Me>('/api/me') })
  const refresh = () => qc.invalidateQueries({ queryKey: ['me'] })
  const fail = (e: Error) => {
    toast.error(e.message)
    throw e
  }
  const save = useMutation({ mutationFn: (patch: { name: string | null; tagline: string | null }) => apiSend<Me>('PATCH', '/api/me', patch) })
  const photo = useMutation({
    mutationFn: (file: File | null) => {
      if (!file) return apiSend<Me>('DELETE', '/api/me/avatar')
      const form = new FormData()
      form.append('file', file)
      return apiSend<Me>('POST', '/api/me/avatar', form)
    },
  })

  if (me.isPending) return <BlockSkeleton rows={3} />
  if (me.error) return <ErrorState error={me.error} />

  return (
    <ProfileSection
      me={me.data}
      labels={{
        profileTitle: 'Your blackcode profile',
        profileDescription:
          'This is your account, not a b/sales one. The name here is the name every blackcode app shows.',
      }}
      onSave={async (patch) => {
        await save.mutateAsync(patch).catch(fail)
        await refresh()
        toast.success('Profile updated')
      }}
      photo={{
        onUpload: async (file) => {
          await photo.mutateAsync(file).catch(fail)
          await refresh()
          toast.success('Photo updated')
        },
        onRemove: async () => {
          await photo.mutateAsync(null).catch(fail)
          await refresh()
          toast.success('Photo removed')
        },
      }}
    />
  )
}

/**
 * The card every settings section in this app is drawn in — the shared
 * `SettingsSection` since 2026-09-28, so account settings look the same in
 * every app. Kept as this app's name for it; `note` is the description.
 */
export function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <SettingsSection title={title} description={note}>
      <div className="space-y-4">{children}</div>
    </SettingsSection>
  )
}

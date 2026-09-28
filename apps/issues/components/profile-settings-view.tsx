'use client'

// Profile — the shared `ProfileSection` (2026-09-28) every app renders, wired
// to `PATCH /api/me` for the name and tagline and to `POST/DELETE
// /api/me/avatar` for the photo (`bk profile avatar`). Until then the photo
// went through `/api/upload` and then `PATCH /api/me { avatar_url }` — two
// requests, and the upload ledger row was the only record of the file: nothing
// indexed `platform.users.avatar_url`, so storage clean-up could delete a photo
// in use. Migration 0050's trigger indexes it now, whichever route set it.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ProfileSection, type ProfileData } from '@blackcode/platform-ui/account/account-settings'

async function send(method: string, url: string, body?: BodyInit, json = false) {
  const res = await fetch(url, {
    method,
    headers: json ? { 'Content-Type': 'application/json' } : undefined,
    body,
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    const message = [j.error, j.suggestion].filter(Boolean).join(' — ') || 'Something went wrong'
    toast.error(message)
    throw new Error(message)
  }
  return res.json()
}

export function ProfileSettingsView() {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<ProfileData> => {
      const res = await fetch('/api/me')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['me'] }),
      queryClient.invalidateQueries({ queryKey: ['active-workspace'] }),
    ])

  if (!data) return null

  return (
    <ProfileSection
      me={data}
      labels={{
        profileTitle: 'Your blackcode profile',
        profileDescription: 'How you appear to teammates across all your workspaces, in every blackcode app.',
      }}
      onSave={async (patch) => {
        await send('PATCH', '/api/me', JSON.stringify(patch), true)
        await refresh()
        toast.success('Profile updated')
      }}
      photo={{
        onUpload: async (file) => {
          const fd = new FormData()
          fd.append('file', file)
          await send('POST', '/api/me/avatar', fd)
          await refresh()
          toast.success('Photo updated')
        },
        onRemove: async () => {
          await send('DELETE', '/api/me/avatar')
          await refresh()
          toast.success('Photo removed')
        },
      }}
    />
  )
}

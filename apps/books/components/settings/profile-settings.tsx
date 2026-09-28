'use client'

// Profile — the blackcode account's name, tagline and photo, drawn by the
// shared `ProfileSection` (2026-09-28) that every app renders.
//
// **Nothing on this tab is books-specific, and that is the point.** It is one
// `platform.users` row, the same one every other app reads, so a name changed
// here is the name they show. The page says so; it is a surprise otherwise, and
// the surprise lands on somebody else's screen.
//
// ── THE PHOTO IS AN UPLOAD NOW, NOT A URL ──────────────────────────────────
// Until 2026-09-28 this tab took a photo URL typed by hand, because this app
// serves no general upload route. `POST/DELETE /api/me/avatar` is the narrow
// route that lets it offer an upload without growing one (`bk profile avatar`).
// A Google-connected account still cannot set one: its photo is synced from
// Google, and the shared section says so instead of offering the button.
//
// Every write goes through `lib/account.ts` — `lib/read-only.test.ts` names that
// module, and this component sends nothing itself.

import { toast } from 'sonner'
import { ProfileSection } from '@blackcode/platform-ui/account/account-settings'
import { useMe } from '@/lib/hooks'
import { useRemoveAvatar, useSetAvatar, useUpdateProfile } from '@/lib/account'
import { useT } from '@/lib/i18n'
import { ErrorState, Loading } from '@/components/states'
import { useAccountLabels } from './labels'

export function ProfileSettings() {
  const me = useMe()
  const update = useUpdateProfile()
  const setAvatar = useSetAvatar()
  const removeAvatar = useRemoveAvatar()
  const t = useT()
  const labels = useAccountLabels()

  if (me.isLoading) return <Loading rows={4} label={t('settings.profile.loading')} />
  if (me.error) return <ErrorState error={me.error} title={t('settings.profile.loadError')} />
  if (!me.data) return null

  // The shared section expects a callback that throws on failure (so it keeps
  // the form as typed) and resolves on success. The account primitive returns
  // a result instead; this is the one adapter between the two.
  async function write(result: Promise<{ ok: true } | { ok: false; message: string }>, done: string) {
    const r = await result
    if (!r.ok) {
      toast.error(r.message)
      throw new Error(r.message)
    }
    // Refetch rather than writing the response into the cache by hand: the row
    // is shared with every other blackcode app and the server is the only thing
    // that knows what it now says.
    await me.refetch()
    toast.success(done)
  }

  return (
    <ProfileSection
      me={me.data}
      labels={labels}
      onSave={(patch) => write(update.run(patch), t('settings.profile.saved'))}
      photo={{
        onUpload: (file) => {
          const form = new FormData()
          form.append('file', file)
          return write(setAvatar.run(form), t('settings.profile.photoUpdated'))
        },
        onRemove: () => write(removeAvatar.run(undefined), t('settings.profile.photoRemoved')),
      }}
    />
  )
}

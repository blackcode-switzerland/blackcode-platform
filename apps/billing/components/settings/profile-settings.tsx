'use client'

// Profile — the shared `ProfileSection` (2026-09-28), wired to `PATCH /api/me`
// and the photo route `POST/DELETE /api/me/avatar` (`meAvatarRoute`). Until
// then this page had no photo control: billing serves no `/api/upload`, and the
// narrow avatar route is what lets it offer one without growing a general
// upload surface.

import { toast } from 'sonner'
import { ProfileSection } from '@blackcode/platform-ui/account/account-settings'
import { useMe } from '@/lib/queries'
import { usePatchMe, useRemoveAvatar, useSetAvatar, toastError } from '@/lib/mutations'
import { ErrorState, LoadingState } from '@/components/ui-kit'
import { PLATFORM_NAME } from '@/lib/app'

async function attempt<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    toastError(e)
    throw e
  }
}

export function ProfileSettings() {
  const me = useMe()
  const save = usePatchMe()
  const setAvatar = useSetAvatar()
  const removeAvatar = useRemoveAvatar()

  if (me.isPending) return <LoadingState variant="detail" />
  if (me.error) return <ErrorState error={me.error} retry={me.refetch} />

  return (
    <ProfileSection
      me={me.data}
      labels={{
        profileTitle: `Your ${PLATFORM_NAME} profile`,
        profileDescription: `This is your account, not a billing one. The name here is the name every ${PLATFORM_NAME} app shows.`,
      }}
      onSave={async (patch) => {
        await attempt(() => save.mutateAsync(patch))
        toast.success('Profile updated')
      }}
      photo={{
        onUpload: async (file) => {
          await attempt(() => setAvatar.mutateAsync(file))
          toast.success('Photo updated')
        },
        onRemove: async () => {
          await attempt(() => removeAvatar.mutateAsync(undefined))
          toast.success('Photo removed')
        },
      }}
    />
  )
}

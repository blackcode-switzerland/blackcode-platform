'use client'

// Your name and tagline — `platform.users`, the same row every blackcode app
// reads. Says so, because a Settings screen inside one app reads as that app's
// settings and this one is not.
//
// Through `lib/mutations.ts`' `usePatchMe`, not a bespoke fetch: it is already
// the app's one account-write hook and it invalidates `['me']`, which is the
// same query the sidebar's account menu reads — a name changed here updates
// there with no reload.
//
// Avatar upload is NOT built here: billing has no `/api/upload` route in this
// phase (only `/api/me`, `/api/tokens`, `/api/workspaces/**`), so the field
// this app can offer is name + tagline, exactly what `PATCH /api/me` accepts.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { MemberAvatar } from '@blackcode/platform-ui/ui/member-avatar'
import { Button } from '@blackcode/platform-ui/ui/button'
import { Input } from '@blackcode/platform-ui/ui/input'
import { useMe } from '@/lib/queries'
import { usePatchMe, toastError } from '@/lib/mutations'
import { Section, FormField } from '@/components/ui-kit'
import { ErrorState, LoadingState } from '@/components/ui-kit'

export function ProfileSettings() {
  const me = useMe()
  const save = usePatchMe()

  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  const [loaded, setLoaded] = useState(false)

  // Seeded ONCE — re-seeding on every render of fresh data would overwrite
  // what somebody is typing the moment a background refetch lands.
  useEffect(() => {
    if (me.data && !loaded) {
      setName(me.data.name ?? '')
      setTagline(me.data.tagline ?? '')
      setLoaded(true)
    }
  }, [me.data, loaded])

  if (me.isPending) return <LoadingState variant="detail" />
  if (me.error) return <ErrorState error={me.error} retry={me.refetch} />

  async function onSave() {
    try {
      await save.mutateAsync({ name: name.trim() || null, tagline: tagline.trim() || null })
      toast.success('Profile updated')
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div className="space-y-6">
      <Section
        title="Your blackcode profile"
        description="This is your account, not a billing one. The name here is the name every blackcode app shows."
      >
        <div className="space-y-4">
          <FormField label="Photo">
            <div className="flex items-center gap-3">
              <MemberAvatar name={me.data.name} email={me.data.email} avatarUrl={me.data.avatar_url} size={56} />
              <p className="text-xs text-muted-foreground">
                {me.data.avatar_editable === false
                  ? 'Synced from your Google account, so it is changed there rather than here.'
                  : 'No photo upload here yet — you get your initials, in a colour derived from your name.'}
              </p>
            </div>
          </FormField>

          <FormField label="Email">
            <p className="text-sm text-foreground" data-testid="account-email-value">
              {me.data.email}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {me.data.connected_google ? 'Signed in with Google.' : 'Signed in with a password.'}
            </p>
          </FormField>

          <FormField label="Name" htmlFor="profile-name">
            <Input id="profile-name" data-testid="input-name" value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>

          <FormField label="Tagline" htmlFor="profile-tagline">
            <Input
              id="profile-tagline"
              data-testid="input-tagline"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="What you do here"
            />
          </FormField>

          <div className="flex justify-end">
            <Button onClick={onSave} disabled={save.isPending} data-testid="save-profile">
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Section>
    </div>
  )
}

'use client'

// Profile — the blackcode account's name, tagline and photo.
//
// **Nothing on this tab is books-specific, and that is the point.** It is one
// `platform.users` row, the same one b/issues and b/sales read, so a name
// changed here is the name they show. The page says so; it is a surprise
// otherwise, and the surprise lands on somebody else's screen.
//
// Split out of `app/dashboard/settings/page.tsx` on 2026-08-19, when that single
// scrolling page became four tabs matching the other two apps. Nothing about the
// form changed in the move.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { MemberAvatar } from '@blackcode/platform-ui/ui/member-avatar'
import { useMe } from '@/lib/hooks'
import { useUpdateProfile } from '@/lib/account'
import { useT } from '@/lib/i18n'
import { ErrorState, Loading } from '@/components/states'
import { Section, inputClass } from './section'

export function ProfileSettings() {
  const me = useMe()
  const update = useUpdateProfile()
  const t = useT()

  // Seeded from the query and then owned by the form. Re-seeded when the query
  // resolves — without the effect, the inputs mount empty on the first render
  // (the query is still in flight) and stay empty, which reads as "this account
  // has no name" rather than "not loaded yet".
  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  const [avatar, setAvatar] = useState('')
  useEffect(() => {
    if (!me.data) return
    setName(me.data.name ?? '')
    setTagline(me.data.tagline ?? '')
    setAvatar(me.data.avatar_url ?? '')
  }, [me.data])

  if (me.isLoading) return <Loading rows={4} label={t('settings.profile.loading')} />
  if (me.error) return <ErrorState error={me.error} title={t('settings.profile.loadError')} />
  if (!me.data) return null

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const body: Record<string, string | null> = {
      name: name.trim() || null,
      tagline: tagline.trim() || null,
    }
    // Only sent when the server says it is editable. A Google-connected account
    // has its photo synced on each Google sign-in and `PATCH /api/me` refuses
    // the field outright — sending it anyway would turn a name change into a
    // 403 for exactly the people who cannot do anything about it.
    if (me.data?.avatar_editable) body.avatar_url = avatar.trim() || null

    const saved = await update.run(body)
    if (!saved.ok) {
      // Off the result, not off `update.error` — that is state and is still null
      // in this tick, so every failed save showed the fallback string instead of
      // the server's reason. See lib/account.ts.
      toast.error(saved.message)
      return
    }
    // Refetch rather than writing the response into the cache by hand: the row
    // is shared with every other blackcode app and the server is the only thing
    // that knows what it now says.
    await me.refetch()
    toast.success(t('settings.profile.saved'))
  }

  return (
    <Section
      title={t('settings.profile.title')}
      note={t('settings.profile.note')}
    >
      <form onSubmit={onSubmit} className="space-y-3.5">
        <div className="flex items-center gap-3">
          <MemberAvatar
            name={me.data.name}
            email={me.data.email}
            avatarUrl={avatar || me.data.avatar_url}
            size={44}
          />
          <div className="min-w-0 flex-1">
            <label
              htmlFor="avatar"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              {t('settings.profile.photoUrl')}
            </label>
            <input
              id="avatar"
              type="url"
              value={avatar}
              disabled={!me.data.avatar_editable}
              onChange={(e) => setAvatar(e.target.value)}
              className={inputClass + (me.data.avatar_editable ? '' : ' opacity-60')}
              placeholder="https://…"
            />
            {!me.data.avatar_editable && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('settings.profile.photoFromGoogle')}
              </p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {t('settings.profile.email')}
          </label>
          {/* Not an input. The address IS the account — changing it is changing
              which account you are, in every app at once — and there is no route
              that does it. A disabled field would imply one exists. */}
          <p id="email" className="text-sm text-foreground">
            {me.data.email}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {me.data.connected_google
              ? t('settings.profile.viaGoogle')
              : t('settings.profile.viaPassword')}
          </p>
        </div>

        <div>
          <label htmlFor="name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {t('settings.profile.name')}
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            placeholder={t('settings.profile.namePlaceholder')}
          />
        </div>

        <div>
          <label
            htmlFor="tagline"
            className="mb-1.5 block text-xs font-medium text-muted-foreground"
          >
            {t('settings.profile.tagline')}
          </label>
          <input
            id="tagline"
            type="text"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            className={inputClass}
            placeholder={t('settings.profile.taglinePlaceholder')}
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={update.pending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {update.pending ? t('settings.profile.saving') : t('settings.profile.save')}
          </button>
        </div>
      </form>
    </Section>
  )
}

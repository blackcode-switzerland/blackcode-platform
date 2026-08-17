'use client'

// Account settings — decision D-E. Neither this page nor the marketing page is
// in the plan; both are small, both are things the other two apps have and this
// one did not, and both are written up in the sprint-1 report rather than
// negotiated in advance.
//
// **Nothing on this page is books-specific**, which is the point: it is the
// blackcode account, the same row `platform.users` holds for every app.
//
// ── WHAT IS HERE, AND WHAT IS DELIBERATELY NOT ─────────────────────────────
//   profile        name, tagline, photo — `PATCH /api/me`, which books exports
//   appearance     the theme. Local to this browser (`next-themes`), not a write
//   account        the facts, and two honest refusals
//
//   NO password change. `apps/sales` has one over `@blackcode/platform-email`
//   and a set of `/api/auth/password-reset/*` routes; **b/books has neither the
//   dependency nor the routes** (checked 2026-08-17: `app/api/auth/` holds
//   `register` and `[...nextauth]`, nothing else). Adding a route is the
//   backend's side of the wall — every route in this repo needs a matching `bk`
//   command or the build fails — so this page says where the password CAN be
//   changed today instead of rendering a form that would 404.
//
//   NO close-account button, and that is not a gap to fill later. See the block
//   on `<AccountFacts>`.

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { Monitor, Moon, Sun } from 'lucide-react'
import { MemberAvatar } from '@blackcode/platform-ui/ui/member-avatar'
import { useMe } from '@/lib/hooks'
import { useUpdateProfile } from '@/lib/account'
import { ErrorState, Loading } from '@/components/states'

export default function SettingsPage() {
  const me = useMe()

  if (me.isLoading) return <Loading rows={4} label="Loading your account" />
  if (me.error) return <ErrorState error={me.error} title="Your account could not be loaded" />
  if (!me.data) return null

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <ProfileSection />
      <AppearanceSection />
      <AccountFacts />
    </div>
  )
}

/* ------------------------------------------------------------------ profile */

function ProfileSection() {
  const me = useMe()
  const update = useUpdateProfile()

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
    toast.success('Profile saved.')
  }

  return (
    <section>
      <h2 className="text-base font-semibold text-foreground">Profile</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        This is your blackcode account. A change here is what b/issues and b/sales show too.
      </p>

      <form onSubmit={onSubmit} className="mt-4 space-y-3.5">
        <div className="flex items-center gap-3">
          <MemberAvatar
            name={me.data?.name}
            email={me.data?.email}
            avatarUrl={avatar || me.data?.avatar_url}
            size={44}
          />
          <div className="min-w-0 flex-1">
            <label htmlFor="avatar" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Photo URL
            </label>
            <input
              id="avatar"
              type="url"
              value={avatar}
              disabled={!me.data?.avatar_editable}
              onChange={(e) => setAvatar(e.target.value)}
              className={inputClass + (me.data?.avatar_editable ? '' : ' opacity-60')}
              placeholder="https://…"
            />
            {!me.data?.avatar_editable && (
              <p className="mt-1 text-xs text-muted-foreground">
                Your photo comes from Google and re-syncs each time you sign in with it.
              </p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            placeholder="Your name"
          />
        </div>

        <div>
          <label htmlFor="tagline" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Tagline
          </label>
          <input
            id="tagline"
            type="text"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            className={inputClass}
            placeholder="What you do"
          />
        </div>

        <button
          type="submit"
          disabled={update.pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {update.pending ? 'Saving…' : 'Save'}
        </button>
      </form>
    </section>
  )
}

/* --------------------------------------------------------------- appearance */

function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  // `next-themes` cannot know the current choice until it has read the DOM, so
  // rendering the selected state before mount produces a hydration mismatch.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const options = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ] as const

  return (
    <section className="border-t border-border pt-8">
      <h2 className="text-base font-semibold text-foreground">Appearance</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Stored in this browser, not on your account — so it does not follow you to another machine,
        and it does not change what anyone else sees.
      </p>

      <div className="mt-4 grid max-w-md grid-cols-3 gap-2">
        {options.map((opt) => {
          const active = mounted && theme === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTheme(opt.value)}
              aria-pressed={active}
              className={
                'flex flex-col items-center gap-1.5 rounded-md border px-3 py-3 text-[13px] transition-colors ' +
                (active
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent')
              }
            >
              <opt.icon size={16} />
              {opt.label}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ account */

/**
 * The facts, and two things this app will not pretend to do.
 *
 * ── CLOSING AN ACCOUNT IS AN OPEN QUESTION, NOT A MISSING BUTTON ───────────
 * Every app on this platform has to answer "what do you hold for this person,
 * and how do you remove it" (`AppContext.footprint`). **b/books legally cannot
 * remove it: art. 958f CO requires the books and their supporting documents to
 * be kept for ten years.** No other app has hit this, and the account-close flow
 * has never had to handle an app that refuses.
 *
 * That is a platform decision and it is above this page — it is raised in
 * `booksFrontend/00-decisions.md` and in the sprint-1 report, and it needs an
 * owner. What this page must not do in the meantime is offer a button whose
 * outcome nobody has decided, or repeat a reassuring sentence from another app
 * that is not true here. So it says what is true and stops.
 */
function AccountFacts() {
  const me = useMe()
  return (
    <section className="border-t border-border pt-8">
      <h2 className="text-base font-semibold text-foreground">Account</h2>

      <dl className="mt-4 space-y-2.5 text-sm">
        <div className="flex gap-4">
          <dt className="w-32 shrink-0 text-muted-foreground">Email</dt>
          <dd className="text-foreground">{me.data?.email}</dd>
        </div>
        <div className="flex gap-4">
          <dt className="w-32 shrink-0 text-muted-foreground">Sign-in</dt>
          <dd className="text-foreground">
            {me.data?.connected_google ? 'Google' : 'Email and password'}
          </dd>
        </div>
      </dl>

      <div className="mt-5 space-y-3 text-sm text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Your password.</span> It is the blackcode
          account&rsquo;s, shared with every blackcode app. b/books has no password form yet —
          change or reset it from b/issues or b/sales and it changes here at the same moment.
        </p>
        <p>
          <span className="font-medium text-foreground">Closing your account.</span> b/books keeps
          accounting records, and the law requires them to be kept for ten years (art. 958f CO), so
          this app cannot simply delete what it holds for you. What closing an account means for
          those records has not been settled — ask before you start, rather than closing it from
          another app and finding out.
        </p>
      </div>
    </section>
  )
}

const inputClass =
  'w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/25'

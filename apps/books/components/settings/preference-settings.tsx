'use client'

// Preferences — the theme, and the language.
//
// ===========================================================================
// TWO SETTINGS ON ONE PAGE THAT ARE STORED IN DIFFERENT PLACES
// ===========================================================================
// The theme lives in the BROWSER (`next-themes` writes localStorage; nothing is
// sent to the server). The language lives on the ACCOUNT — `platform.users.locale`,
// one row across every blackcode app — so it follows you to another machine and
// to b/issues the day b/issues supports it.
//
// **That difference is exactly what this page exists to make clear.** A settings
// page that does not distinguish "saved to your account" from "saved on this
// laptop" is how somebody concludes the app has lost their preference, so each
// section says which of the two it is rather than leaving it to be discovered.
//
// b/sales' Preferences tab holds `ui_mode`, a per-(user, workspace) row in its
// own schema. b/books has no such table and should not grow one to fill a tab:
// its web surface is read-mostly by design, so there is no "read-only mode" to
// choose — that is simply what the app is.

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { Globe, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { LOCALES, LOCALE_NAMES, type Locale } from '@blackcode/platform-i18n'
import { useSetLocale } from '@/lib/account'
import { useMe } from '@/lib/hooks'
import { useLocale, useT } from '@/lib/i18n'
import type { BooksKey } from '@/lib/dictionary'
import { Section } from './section'

const THEMES: ReadonlyArray<{ value: string; labelKey: BooksKey; icon: LucideIcon }> = [
  { value: 'light', labelKey: 'settings.theme.light', icon: Sun },
  { value: 'dark', labelKey: 'settings.theme.dark', icon: Moon },
  { value: 'system', labelKey: 'settings.theme.system', icon: Monitor },
]

export function PreferenceSettings() {
  return (
    <div className="space-y-4">
      <AppearanceSection />
      <LanguageSection />
    </div>
  )
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  const t = useT()
  // `next-themes` cannot know the current choice until it has read the DOM, so
  // rendering the selected state before mount produces a hydration mismatch.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <Section title={t('settings.appearance')} note={t('settings.appearanceNote')}>
      <div className="grid max-w-md grid-cols-3 gap-2">
        {THEMES.map((opt) => {
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
              {t(opt.labelKey)}
            </button>
          )
        })}
      </div>
    </Section>
  )
}

/**
 * The language.
 *
 * ── THE SELECTED STATE COMES FROM THE COLUMN, NOT FROM WHAT IS ON SCREEN ───
 * `me.data.locale` is the stored preference and is `null` for somebody who has
 * never chosen; `useLocale()` is what the page is being RENDERED in, which for
 * that person is whatever their browser asked for. Reading the second here would
 * make "Follow my browser" impossible to show as the current state — the English
 * option would look chosen the moment the resolution chain landed on English,
 * and there would be no way to tell "I picked English" from "nobody picked
 * anything".
 *
 * That is the whole reason `GET /api/me` serves the raw column rather than the
 * resolved locale.
 *
 * ── AND THERE ARE THREE OPTIONS, NOT TWO ──────────────────────────────────
 * English, Français, and **Follow my browser** — which writes `null` and hands
 * the reader back to `Accept-Language`. Without it a choice made once could be
 * changed but never undone, and the nullable column would have no way to be
 * reached from the UI at all.
 *
 * ── WHAT IT DOES NOT CHANGE ───────────────────────────────────────────────
 * The statutory line names of the bilan and the compte de résultat, and anything
 * exported or filed. Said here because this is where somebody makes the choice
 * and forms an expectation about it. The same sentence is owed to the export
 * when the export exists — `lib/statements.ts` carries it beside `legal()`.
 */
function LanguageSection() {
  const me = useMe()
  const current = useLocale()
  const setLocale = useSetLocale()
  const t = useT()

  // `undefined` while the row is in flight — distinct from `null`, which is the
  // real answer "no preference". Nothing is drawn as selected until it arrives,
  // rather than "Follow my browser" flashing as chosen for a French reader.
  const stored = me.data?.locale
  const known = me.data !== undefined

  async function choose(next: Locale | null) {
    const saved = await setLocale.run(next)
    if (!saved.ok) {
      toast.error(saved.message)
      return
    }
    toast.success(t('settings.languageSaved'))
  }

  return (
    <Section title={t('settings.language')} note={t('settings.languageNote')}>
      <div className="grid max-w-md grid-cols-3 gap-2">
        {LOCALES.map((loc) => (
          <button
            key={loc}
            type="button"
            disabled={setLocale.pending}
            onClick={() => void choose(loc)}
            aria-pressed={known && stored === loc}
            className={optionClass(known && stored === loc)}
          >
            {/* The language's name IN ITSELF — "Français", never "French". A
                picker that names a language in a language the reader does not
                read is a picker they cannot use, which is the one thing it must
                not be. `LOCALE_NAMES` is the platform's list, not ours. */}
            <span className="text-[13px]">{LOCALE_NAMES[loc]}</span>
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{loc}</span>
          </button>
        ))}
        <button
          type="button"
          disabled={setLocale.pending}
          onClick={() => void choose(null)}
          aria-pressed={known && stored === null}
          className={optionClass(known && stored === null)}
        >
          <Globe size={15} />
          <span className="text-[13px] leading-tight">{t('settings.languageBrowser')}</span>
        </button>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {known && stored === null
          ? t('settings.languageBrowserNote')
          : t('settings.languageStatutory')}
      </p>
      {/* The reader's current effective language, so the state is never
          ambiguous: with "Follow my browser" selected, nothing else on this page
          says WHICH language that turned out to be. */}
      <p className="sr-only" aria-live="polite">
        {LOCALE_NAMES[current]}
      </p>
    </Section>
  )
}

function optionClass(active: boolean): string {
  return (
    'flex flex-col items-center justify-center gap-1 rounded-md border px-3 py-3 text-center transition-colors disabled:opacity-60 ' +
    (active
      ? 'border-primary bg-primary/10 text-foreground'
      : 'border-border text-muted-foreground hover:bg-accent')
  )
}

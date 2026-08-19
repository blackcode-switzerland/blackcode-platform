'use client'

// Preferences.
//
// ── ONE SETTING, AND IT IS NOT ON YOUR ACCOUNT ─────────────────────────────
// b/sales' Preferences tab holds `ui_mode`, a per-(user, workspace) row in its
// own schema. b/books has no such table and should not grow one to fill a tab:
// its web surface is read-mostly by design, so there is no "read-only mode" to
// choose — that is simply what the app is.
//
// What is here is the theme, and it is deliberately said out loud that this
// lives in the BROWSER. `next-themes` writes localStorage; nothing is sent to
// the server, nothing follows you to another machine, and nothing anybody else
// sees changes. A settings page that does not distinguish "saved to your
// account" from "saved on this laptop" is how somebody concludes the app has
// lost their preference.

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun } from 'lucide-react'
import { Section } from './section'

const OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const

export function PreferenceSettings() {
  const { theme, setTheme } = useTheme()
  // `next-themes` cannot know the current choice until it has read the DOM, so
  // rendering the selected state before mount produces a hydration mismatch.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <Section
      title="Appearance"
      note="Stored in this browser, not on your account — so it does not follow you to another machine, and it does not change what anyone else sees."
    >
      <div className="grid max-w-md grid-cols-3 gap-2">
        {OPTIONS.map((opt) => {
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
    </Section>
  )
}

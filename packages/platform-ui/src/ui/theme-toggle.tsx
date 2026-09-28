'use client'

// The light/dark switch on every SIGNED-OUT page (landing, login, the agent
// page), in every app.
//
// Shared rather than copied because four apps need it unchanged: each app's
// `app/providers.tsx` mounts the same `next-themes` ThemeProvider (class
// strategy), so the toggle has nothing app-specific to know. The signed-in
// shells keep their own switches — they sit in menus with their own layout.
//
// ── HYDRATION ────────────────────────────────────────────────────────────────
// The server cannot know the visitor's theme, so EVERYTHING that depends on it
// — the glyph AND the aria-label — waits for mount. The copy this replaced
// (apps/issues/components/marketing/theme-toggle.tsx) gated only the glyph, and
// its aria-label raised a hydration mismatch on every landing-page load for a
// visitor whose resolved theme was not the default.

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { cn } from '../utils'

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const isDark = resolvedTheme === 'dark'
  const label = mounted ? (isDark ? 'Switch to light theme' : 'Switch to dark theme') : 'Switch theme'

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        className,
      )}
    >
      {mounted ? isDark ? <Sun size={15} /> : <Moon size={15} /> : <span className="size-[15px]" />}
    </button>
  )
}

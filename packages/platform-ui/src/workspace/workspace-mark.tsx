'use client'

// A workspace's picture: its logo when it has one, otherwise its initial on a
// colour derived from its name — the same derivation `MemberAvatar` uses for
// people, so a workspace keeps its colour everywhere it is drawn.
//
// Shared since 2026-09-28. Until then issues drew this twice (switcher and
// list, `WsAvatar`), sales once, and billing a different, single-colour letter;
// four drawings of one thing is how the apps came to disagree about it.

import { avatarColor } from '../ui/member-avatar'
import { cn } from '../utils'

export function WorkspaceMark({
  name,
  logoUrl,
  size = 22,
  className,
}: {
  name: string
  logoUrl?: string | null
  size?: number
  className?: string
}) {
  const style = { width: size, height: size }
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- this package has no next/image; logos are small and already sized
      <img
        src={logoUrl}
        alt=""
        style={style}
        className={cn('shrink-0 rounded-md object-cover ring-1 ring-inset ring-border', className)}
      />
    )
  }
  return (
    <span
      aria-hidden
      className={cn('flex shrink-0 items-center justify-center rounded-md font-semibold text-white', className)}
      style={{ ...style, background: avatarColor(name), fontSize: Math.round(size * 0.46) }}
    >
      {(name.trim()[0] ?? 'W').toUpperCase()}
    </span>
  )
}

import { SettingsFrame } from '@/components/settings-nav'

// Account settings — the same sticky header as a workspace's settings page and
// the shared tab frame every app renders (2026-09-28).
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <header className="sticky top-0 z-10 flex h-12 items-center border-b border-border bg-background/80 px-4 backdrop-blur">
        <h1 className="text-[15px] font-semibold">Account settings</h1>
      </header>
      <SettingsFrame>{children}</SettingsFrame>
    </div>
  )
}

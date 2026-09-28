// A titled block on a settings page — since 2026-09-28 the shared
// `SettingsSection`, so the Account tab's own blocks (password, your data,
// elsewhere) sit in the same cards as the shared profile, token and appearance
// sections beside them. `note` is the shared component's `description`.
//
// Nothing but layout, and it must stay that way: a component that decides
// anything is a component the next panel has to read before it can use it.

import { SettingsSection } from '@blackcode/platform-ui/account/account-settings'

export function Section({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <SettingsSection title={title} description={note}>
      <div className="space-y-3">{children}</div>
    </SettingsSection>
  )
}

/** The one input style every settings field uses. */
export const inputClass =
  'w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/25'

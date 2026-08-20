// A titled block on a settings page. Nothing but layout.
//
// It exists so the five settings panels cannot drift apart in spacing and
// heading weight while each one is edited on its own day — the same reason
// `<ScreenFrame>` exists for the thirteen data screens. There is no logic here
// and there must not be: a component that decides anything is a component the
// next panel has to read before it can use it.

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
    <section className="rounded-lg border border-border bg-card px-5 py-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {note && <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{note}</p>}
      <div className="mt-3.5 space-y-3">{children}</div>
    </section>
  )
}

/** The one input style every settings field uses. */
export const inputClass =
  'w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/25'

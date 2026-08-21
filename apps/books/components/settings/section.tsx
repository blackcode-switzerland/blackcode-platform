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
    // The same card, the same hairline and the same small-caps label as
    // `components/section.tsx` — settings is not a different visual language
    // from the rest of the app, and it was drifting into one (a semibold
    // foreground `h2` where every data screen uses a muted small-caps label).
    // It stays a separate component because its BODY is a form: labelled
    // inputs with their own rhythm, which `<Section>`'s `bodyClassName` would
    // have to be told about on every call.
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </h2>
      </div>
      <div className="px-4 py-3.5">
        {note && (
          <p className="mb-3.5 max-w-[95ch] text-[13px] leading-relaxed text-muted-foreground">
            {note}
          </p>
        )}
        <div className="space-y-3">{children}</div>
      </div>
    </section>
  )
}

/** The one input style every settings field uses. */
export const inputClass =
  'w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/25'

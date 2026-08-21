// `<PageHeader>` — the one heading every screen in this app uses.
//
// ===========================================================================
// WHAT IT REPLACES
// ===========================================================================
// Thirteen screens, thirteen hand-written headings: three different sizes, some
// with a lead paragraph and some without, the scope controls sometimes in the
// topbar and sometimes inline. A reader arriving on a new screen had to find the
// title before they could read it.
//
// ── THE EYEBROW IS THE ONLY AMBER ON THE PAGE, AND IT IS DOING A JOB ────────
// It names the AREA, so a screen reached from a cross-link — taxes, patrimoine,
// the compliance register, an analyse detail — says where the reader has landed
// without them reading the sidebar. That is worth an accent. Nothing else in the
// header gets one.
//
// ── THE LEAD IS ONE SENTENCE AND IT SAYS WHAT THE PAGE IS FOR ──────────────
// Not what it contains — the table below says that. The overview's old lead
// ("Each one is a separate set of accounts. The control in the top bar chooses
// which one every other screen is about.") is the shape to keep: it tells a
// reader who has never seen the product what they are looking at and how the
// screen relates to the rest.

import type { ReactNode } from 'react'

export function PageHeader({
  eyebrow,
  title,
  lead,
  actions,
  meta,
}: {
  /** The area. Already translated. Rendered in the app's accent, small caps. */
  eyebrow?: ReactNode
  /** The screen. Already translated. */
  title: ReactNode
  /** One sentence on what the screen is for. Already translated. */
  lead?: ReactNode
  /** Controls that belong to the page — search, a filter, a link out. */
  actions?: ReactNode
  /**
   * A fact about what is on screen that is not a control and not the title:
   * which book, which year, how many rows. Sits under the lead, quiet.
   */
  meta?: ReactNode
}) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-primary-strong">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {lead ? (
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{lead}</p>
        ) : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

// `<StatementHeading>` — the French title, the English gloss, and the three
// facts that say WHICH document this is.
//
// A balance sheet without its entity and its exercice is not a balance sheet; it
// is a column of numbers. Both statement screens and the patrimoine screen carry
// the same three, so they are written once — a heading assembled per screen is
// three chances for one of them to omit the year.
//
// The French is the statutory title (D-A: French survives in the statutory
// layer and nowhere else), the English sits beside it as the interface gloss,
// and the article is cited because a reader checking a filing needs to know
// which structure they are looking at.

export function StatementHeading({
  fr,
  en,
  article,
  bookName,
  exercice,
  exerciceStatus,
  children,
}: {
  fr: string
  en: string
  /** `art. 959a CO`. Null for a document the code does not fix the shape of. */
  article?: string
  bookName: string | undefined
  exercice: number | null
  /**
   * Whether that year has been CLOSED — `scope.exerciceStatus`.
   *
   * ── OPTIONAL, AND THE THREE CALLERS THAT PASS IT ARE THE POINT ────────────
   * Six screens use this heading. Only the three STATUTORY DOCUMENTS pass this
   * — the bilan, the compte de résultat and the patrimoine statement — because
   * those are the pages a person prints and sends to a fiduciary, and a
   * statement of a filed year is a different document from a draft of the same
   * numbers. The heading's whole job is "which document is this"; once a year
   * can be closed, its status is part of that answer.
   *
   * Management, taxes and analyses deliberately do not. They are derived
   * management views rather than documents, the year switcher in the header says
   * it on every one of them anyway, and three more wordings of one legal fact is
   * three more things to go stale. The full decision, including the one change
   * that would revisit it, is written at `<ExerciceSwitcher>` in
   * `components/books-shell.tsx`.
   *
   * Undefined and `null` both render nothing, and they mean different things —
   * "this caller does not say" and "it cannot be told". Neither may be drawn as
   * open: see `lib/scope.ts`.
   */
  exerciceStatus?: 'open' | 'closed' | null
  children?: React.ReactNode
}) {
  return (
    <div className="mb-4">
      <h1 className="text-lg font-semibold text-foreground">
        {fr}
        <span className="ml-2 text-sm font-normal text-muted-foreground">{en}</span>
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {/* `bookName` is undefined only while the book list is in flight, and
            `<ScreenFrame>` holds the page on a skeleton until then — so an em
            dash here is a state the reader should not be able to reach. It is
            written anyway rather than `??  ''`, because an empty gap where the
            company name belongs is the one thing on this line nobody notices is
            missing. */}
        {bookName ?? '—'}
        {' · '}
        exercice {exercice ?? '—'}
        {/* `=== 'closed'`, never `!== 'open'`. `null` is "cannot be told" and
            marking an unknown year as filed is the wrong half of the mistake to
            make on a document somebody files. */}
        {exerciceStatus === 'closed' && (
          <span
            className="ml-1.5 rounded border border-border px-1 py-px text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground"
            title="This fiscal year has been closed. Nothing can be posted into it, and there is no reopen."
          >
            closed
          </span>
        )}
        {article && (
          <>
            {' · '}
            {article}
          </>
        )}
      </p>
      {children}
    </div>
  )
}

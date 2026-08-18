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
  children,
}: {
  fr: string
  en: string
  /** `art. 959a CO`. Null for a document the code does not fix the shape of. */
  article?: string
  bookName: string | undefined
  exercice: number | null
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

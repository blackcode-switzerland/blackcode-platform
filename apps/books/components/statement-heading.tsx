'use client'

// `<StatementHeading>` — the document's name in the reader's language, its LEGAL
// name beneath, and the three facts that say WHICH document this is.
//
// A balance sheet without its entity and its exercice is not a balance sheet; it
// is a column of numbers. Both statement screens and the patrimoine screen carry
// the same three, so they are written once — a heading assembled per screen is
// three chances for one of them to omit the year.
//
// ===========================================================================
// THE STATUTORY-NAME DECISION, IMPLEMENTED (Bala, 2026-08-20 — D-A rewritten)
// ===========================================================================
// Art. 959a and 959b name these documents, and a statement filed in Switzerland
// is filed in a national language. The position this app has held is that the
// French is not decoration — it is what the document IS.
//
// So the switch changes the heading, **and the legal name stays visible as a
// subtitle**:
//
//   English reader:  Income statement   *compte de résultat*
//   French reader:   Compte de résultat
//
// Nobody loses the legal identity of the document, and nobody has to read a
// language they did not choose.
//
// **The order is inverted from what shipped before.** Until today the FRENCH was
// the h1 and the English was the small gloss, for every reader — which was
// correct while the product was English-only with a statutory exception, and is
// wrong the moment a reader can say "I read French": it made the English gloss
// the thing an English reader had to squint at on the one screen they are most
// likely to be checking against a filing.
//
// ── FOR A FRENCH READER THE SUBTITLE IS NOT RENDERED, AND IT IS NOT SKIPPED ─
// It is not rendered *because it is the same string*. `ui` and `legal` are two
// dictionary entries whose French sides are identical by design
// (`lib/dictionary/statements.ts` says so), and printing "Bilan Bilan" is a
// rendering fault, not bilingualism. The test is on the VALUES, so a document
// whose French UI name ever genuinely differs from its legal name — none does
// today — would show both without anybody changing this file.
//
// **What is on screen is not what would be filed.** Nothing exported or filed
// consults the locale: `legal()` in `lib/label.ts` carries that rule, and the
// export that does not exist yet is where it has to be honoured.

import { useT } from '@/lib/i18n'

export function StatementHeading({
  /**
   * The document's LEGAL name — French, in both languages.
   *
   * `t('statements.bilanLegal')`. Named `fr` since the day this component was
   * written and kept: it says what the value is.
   */
  fr,
  /**
   * The document's name IN THE READER'S LANGUAGE — `t('statements.bilanUi')`.
   *
   * Still named `en` for the same reason `fr` is named `fr`: renaming a prop
   * that three callers pass, in the same change that inverts what it is used
   * for, is two edits to review as one. What it MEANS changed and this comment
   * is the record of it.
   */
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
  const t = useT()
  return (
    <div className="mb-4">
      <h1 className="text-lg font-semibold text-foreground">
        {en}
        {/* Identical strings mean the reader's language IS the legal one. See
            the header — the test is on the values, not on the locale. */}
        {fr !== en && (
          <span className="ml-2 text-sm font-normal text-muted-foreground">{fr}</span>
        )}
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
        {t('statements.exercice', { year: exercice ?? '—' })}
        {/* `=== 'closed'`, never `!== 'open'`. `null` is "cannot be told" and
            marking an unknown year as filed is the wrong half of the mistake to
            make on a document somebody files. */}
        {exerciceStatus === 'closed' && (
          <span
            className="ml-1.5 rounded border border-border px-1 py-px text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground"
            title={t('chrome.closedTitle')}
          >
            {t('chrome.closed')}
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

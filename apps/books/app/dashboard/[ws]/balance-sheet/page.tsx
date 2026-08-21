'use client'

// Balance sheet — art. 959a CO, with its amounts.
//
// ===========================================================================
// THREE THINGS THIS PAGE MUST DO, AND ONE IT MUST NOT
// ===========================================================================
//   1. **Render every legal line, including the zeroes.** `<StatementTable>`
//      owns that; the collapse it offers is visual and off by default.
//   2. **Render the actif = passif check.** The route serves `balanced` and
//      `ecart` precisely so a disagreement is visible rather than a 500 that
//      hides which book is broken. It is shown whichever way it comes out —
//      a check that only appears when it fails is a check nobody believes.
//   3. **Treat the RI's refusal as a screen, not an error.** See
//      `<SimplifiedBookNotice>`.
//
// And the one it must not: **restructure a legal category to fix a number.**
// If a figure looks wrong the entry's account is wrong, or its
// `statement_position` is. Not this file.
//
// ── THE AMOUNTS ARE STRINGS AND STAY STRINGS ──────────────────────────────
// The phase-0 version of this page rendered `null` for every line and said so in
// a banner. That banner is gone because the route landed. What has NOT changed
// is that nothing here parses an amount: `<Money>` takes the wire string, and
// the only arithmetic on the page is `ecart`, which the SERVER computed in
// centimes.
//
// ── THREE FIGURES DELIBERATELY DIFFER FROM THE MOCKUP, BY 4850.00 ─────────
// *Résultat de l'exercice*, *résultat reporté*, and the CR's *autres charges*.
// blackcode's two 2025-dated entries live in a CLOSED exercice 2025 where the
// mockup summed both years. `lib/db/seed.ts` explains it; `seed-parity.test.ts`
// pins it. If you see that number, the API is right.

import { useParams } from 'next/navigation'
import { useScope } from '@/lib/scope'
import { useBilan, isSimplifiedRefusal } from '@/lib/hooks'
import { bilanGroups } from '@/lib/statement-view'
import { StatementTable } from '@/components/statement-table'
import { ScreenFrame } from '@/components/screen-frame'
import { Section } from '@/components/section'
import { Stat, StatRow } from '@/components/stat'
import { SimplifiedBookNotice } from '@/components/simplified-notice'
import { NoExerciceNotice, isNoExerciceRefusal } from '@/components/no-exercice-notice'
import { ErrorState, Loading } from '@/components/states'
import { Money } from '@/components/money'
import { StatementHeading } from '@/components/statement-heading'
import { PostedOnlyNote } from '@/components/posted-only-note'
import { BalanceCheck } from '@/components/balance-check'
import { useT } from '@/lib/i18n'

export default function Page() {
  const params = useParams<{ ws: string }>()
  const scope = useScope()
  const t = useT()
  const base = `/dashboard/${params.ws}`
  const bilan = useBilan(params.ws, scope)

  return (
    <ScreenFrame title={t('statements.bilanUi')}>
      <StatementHeading
        // `fr` is the LEGAL name and is French in both languages; `en` is the
        // name in the reader's language. See `<StatementHeading>`'s header for
        // the decision and for why the props kept their names.
        fr={t('statements.bilanLegal')}
        en={t('statements.bilanUi')}
        // Not cited when the book has no such statement: heading a page
        // "art. 959a CO" and then explaining this book has no art. 959a
        // balance sheet contradicts itself in two lines. F4.
        // Cited only when the document actually exists. Heading a page
        // "art. 959a CO" above an explanation that this book has no such
        // statement contradicts itself in two lines — true for a simplified
        // book (F4) and equally for one whose exercice is not open yet.
        article={bilan.data ? t('statements.bilanArticle') : undefined}
        bookName={scope.record?.name}
        exercice={scope.exercice}
        exerciceStatus={scope.exerciceStatus}
      />

      {/* F1: the statements exclude staged entries and said so nowhere, while
          their own drill-down shows them. Disclosed here rather than implied.

          Gated on the statement EXISTING. Rendered unconditionally it announced
          "every posting below is counted" above the RI refusal, which has no
          postings and no statement — a confident wrong sentence, of exactly the
          kind this note was added to remove. Caught in the browser, not by a
          test: nothing here can fail. */}
      {bilan.data && <PostedOnlyNote ws={params.ws} scope={scope} journal={scope.journal} />}

      {bilan.isLoading && <Loading rows={8} label={t('statements.loadingBilan')} />}

      {/* The refusal is checked BEFORE the generic error, because it is not one.
          Ordering these the other way round would put a red box on a book whose
          books are in perfect order. */}
      {isSimplifiedRefusal(bilan.error) && (
        <SimplifiedBookNotice
          error={bilan.error}
          statement={t('statements.bilanUi').toLowerCase()}
          because={t('statements.simplifiedBecauseBilan')}
          base={base}
          scope={scope}
          bookName={scope.record?.name}
        />
      )}

      {/* Also not a failure: a book whose exercice has not been opened yet.
          Same rule as the refusal above — nothing broke, so nothing is red. */}
      {isNoExerciceRefusal(bilan.error) && (
        <NoExerciceNotice
          error={bilan.error}
          statement={t('statements.bilanUi').toLowerCase()}
          bookName={scope.record?.name}
        />
      )}

      {bilan.error && !isSimplifiedRefusal(bilan.error) && !isNoExerciceRefusal(bilan.error) && (
        <ErrorState error={bilan.error} title={t('statements.bilanFailed')} />
      )}

      {bilan.data && (
        <>
          {/* ── THE THREE FIGURES A READER OPENS A BILAN FOR ─────────────────
              They are also rendered at the FOOT of the document below, and that
              is deliberate duplication rather than an oversight. A bilan is a
              statutory document somebody prints and sends to a fiduciary, and a
              document's totals belong at its foot — moving them to the top would
              be reformatting an art. 959a statement to suit a screen.

              The strip is not the document. It is the summary of it, for the
              reader who came to check one number and should not have to scroll
              a full chart of accounts to reach it. Both read the same three
              fields off `bilan.data`, so they cannot disagree.

              `résultat` is emphasised because it is the figure the year is
              about; the two sides are equal whenever the books are correct, and
              `<BalanceCheck>` below says so in words. */}
          <StatRow>
            <Stat
              caption={t('statements.totalActif')}
              value={<Money value={bilan.data.totalActif} bare />}
            />
            <Stat
              caption={t('statements.totalPassif')}
              value={<Money value={bilan.data.totalPassif} bare />}
            />
            <Stat
              caption={t('statements.resultat')}
              value={<Money value={bilan.data.resultat} bare />}
              emphasis
              basis={t('statements.resultatNote')}
            />
          </StatRow>

          <BalanceCheck
            balanced={bilan.data.balanced}
            ecart={bilan.data.ecart}
            actif={bilan.data.totalActif}
            passif={bilan.data.totalPassif}
          />

          <Section label={t('statements.bilanLegal')} bodyClassName="px-4 py-3.5">
          <StatementTable
            groups={bilanGroups(bilan.data, scope.meta)}
            base={base}
            scope={scope}
          />

          {/* The two side totals, spelled out under the table. `<StatementTable>`
              takes ONE footer and the bilan has two sides, so they are rendered
              here rather than bending the shared component into a shape only
              this screen needs. */}
          <dl className="mt-4 border-t border-border pt-3 text-[13px]">
            <div className="flex items-baseline justify-between py-0.5">
              <dt className="font-medium text-foreground">{t('statements.totalActif')}</dt>
              <dd className="num-total"><Money value={bilan.data.totalActif} /></dd>
            </div>
            <div className="flex items-baseline justify-between py-0.5">
              <dt className="font-medium text-foreground">{t('statements.totalPassif')}</dt>
              <dd className="num-total"><Money value={bilan.data.totalPassif} /></dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-border/60 py-0.5 pt-2">
              <dt className="text-muted-foreground">
                {/* The LEGAL name of the line, French in both languages — it is
                    an art. 959a position, not chrome. The note beside it is
                    ours and is translated. */}
                {t('statements.resultat')}
                <span className="ml-2 text-[11.5px]">{t('statements.resultatNote')}</span>
              </dt>
              <dd className="num"><Money value={bilan.data.resultat} /></dd>
            </div>
          </dl>
          </Section>
        </>
      )}
    </ScreenFrame>
  )
}

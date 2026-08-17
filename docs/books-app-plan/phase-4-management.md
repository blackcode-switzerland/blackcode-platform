# Phase 4: Management and agent write-back

**Goal:** the page Andrea actually looks at to make decisions, plus the contract
that lets an agent write an answer back.

This phase is last on purpose. Analytique reads the ledger, the bilan, the
compte de résultat, VAT and the categories. Built earlier it gets rebuilt.

> **Building in a week?** This whole phase is deferred. See
> [`week-one.md`](week-one.md): the dashboard becomes three numbers on the
> overview, cash, monthly burn and runway. No charts, no analyses journal, no
> agent write back.

## In one look

| | |
|---|---|
| **Data** | Past answers to business questions such as "can we afford this hire", the exact numbers each answer was based on at the time, and which account belongs to which spending category. |
| **Logic** | Work out income per month and spending per month, work out where the money goes by category, and work out the tax estimate from the profit and the equity. |
| **UI** | Four screens go live and all 13 are then finished. The dashboard with real charts is the single biggest piece of frontend work in the project. |

## Module diagram

```
  humans ──▶ UI  ─┐
                  ├──▶ routes ──▶ queries ──▶ database
  agents ──▶ CLI ─┘      ▲
                         │
  agent answers a question and POSTs the record back
```

```
┌─ UI ────────────────────────────────────────────────────────
│  components/analytique   the dashboard, real charts         new
│  components/analyses     the journal list                   new
│  components/analyse      one answer's page                  new
│  components/tax          the statutory snapshot             new
└─────────────────────────────────────────────────────────────

┌─ CLI ───────────────────────────────────────────────────────
│  commands/books/analytique.go                               new
│  commands/books/analyse.go     list, show, record           new
│  commands/books/tax.go                                      new
│  client/books.go                                        altered
└─────────────────────────────────────────────────────────────

┌─ BUSINESS LOGIC ────────────────────────────────────────────
│  app/api/workspaces/[ws]/analytique                         new
│  app/api/workspaces/[ws]/analyses     GET and POST          new
│  app/api/workspaces/[ws]/tax-snapshot                       new
│  lib/derive/analytique.ts  monthly flows, cost breakdown    new
│  lib/derive/vat.ts         the VAT position                 new
│  lib/derive/tax.ts         profit and capital tax           new
│  lib/db/queries/analyses.ts   append only                   new
└─────────────────────────────────────────────────────────────

┌─ DATA ──────────────────────────────────────────────────────
│  lib/db/schema.ts    analysis, analytique_category     altered
│  migrations/0006     the two tables
└─────────────────────────────────────────────────────────────
```

**Platform packages: imported, never altered.** The charts are hand rolled SVG in
this app, not a shared chart kit, because the mockup's chart shapes are specific
to these figures.

**Shared files this phase alters:** none.

**The layer that matters here is UI.** The business logic is arithmetic over
phase 1's derivations and the data is two small tables. The dashboard itself is
the work.

## Build

### Migration 0006: tables

| Table | Notes |
|---|---|
| `analysis` | Append only. A question, a verdict, figures, and a `based_on` snapshot. |
| `analytique_category` | Maps accounts to cost categories (AI tooling, people, office, other). |

`based_on` records what the agent read at answer time, with a label, a value and
a link to the live page. It is a permanent snapshot. **Never recompute it.** A
stored answer that silently changes is worse than a stale one.

The real shape, from the mockup. Note `scenario_label` and `runway_after_months`,
which `DATA-MODEL.md` omits because it was extracted at v17 and these arrived at
v18:

```jsonc
{ "id": 9501, "entity_id": 1,
  "asked": "2026-08-10T20:35", "asked_by": "Andrea", "agent": "claude-code",
  "scenario_label": { "fr": "...", "en": "With a CHF 4,500/month hire" },
  "runway_after_months": 6.9,        // numeric restatement, so charts need no prose parsing
  "question": { "fr": "...", "en": "..." },
  "verdict":  { "fr": "...", "en": "..." },
  "figures":  [ { "label": {}, "value": "CHF 5'175.00" } ],
  "based_on": [ { "label": {}, "value": "CHF 1'806.67",
                  "href": "app-ledger.html?entity=blackcode&account=3400" } ] }
```

### Derivations (`lib/derive/`)

`monthlyFlows`, `costBreakdownFor`, `vatPosition`, `pmProfitTax`, `pmCapitalTax`

All scoped to `(entity, exercice)`. The mockup found a real bug here: its "year
to date" metrics mixed the previous year into the averages because nothing drew a
year boundary. Your version cannot have that bug if phase 1 was done properly.

### Tax constants

`TAX_INFO` with citations. IFD 8.5%, VD base rate with its coefficient, Renens
coefficient, capital tax with art. 118 imputation. Every block carries a
`confirmed` flag and the capital tax carries an open question for the fiduciary.

Tax position tracking over time is b/tax, not here. This is a snapshot only.

**Tax parameters belong to the entity, not to the app.** The mockup hardcodes one
canton and one commune, Vaud and Renens, because that is where all three seeded
books sit. Since the user can create any number of books, a new one may sit in
another canton, and cantonal rates and communal coefficients differ. Model the
parameters as a per entity record keyed on canton and commune, seeded with the
Vaud and Renens values and their citations. A book whose canton has no parameters
yet shows an honest "not configured" state rather than someone else's rates.

### Routes and CLI

| Route | Command |
|---|---|
| `GET /api/workspaces/{ws}/analytique` | `bk books analytique` |
| `GET /api/workspaces/{ws}/analyses` | `bk books analyse list` |
| `GET /api/workspaces/{ws}/analyses/{n}` | `bk books analyse show` |
| `POST /api/workspaces/{ws}/analyses` | `bk books analyse record` |
| `GET /api/workspaces/{ws}/tax-snapshot` | `bk books tax` |

`bk books analyse record` is the agent write-back contract made real. It is how
an outside agent answers "can I hire her" and files the answer.

## Done when

- [ ] All 13 pages render live data
- [ ] Every figure traces to a posting. No invented numbers.
- [ ] An external agent reads the data, answers a question, and writes the record
      back with its `based_on` snapshot
- [ ] Metrics respect the exercice boundary

## Frontend gets

**4 pages live:** Compta analytique with its charts, Analyses journal, Analyse
detail, Impôts snapshot.

Analytique is the flagship page. It is also the longest frontend job in the
project. The shapes exist from phase 0, so the charts can be built against
fixtures during phases 2 and 3 rather than waiting.

## Notes

**No intelligence in the app.** No chat box, no in page AI, no preset what-if
buttons. The app shows data and past answers. Agents live outside and read the
data contract. This is a standing rule across all b/ apps.

**No preset scenarios.** Nobody can guess the question space in advance. Preset
filters over existing data are fine. Preset questions are not.

**Charts are real charts.** SVG or canvas. Not text art.

**Never say consolidated.** The cross entity rollup is aggregation. The word
appears nowhere except inside the personal overview's disclaimer.

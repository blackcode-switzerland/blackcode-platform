# Phase 0: Contract

**Goal:** the frontend dev can build every page before any database exists.

**Adds no tables.** Everything here comes out of the mockup by hand.

> **Building in a week?** See [`week-one.md`](week-one.md). It cuts this phase to
> four screens instead of thirteen and moves every write to the CLI. The
> scaffolding, the JSON contract and the vocabularies below are unchanged and
> still come first.

## In one look

| | |
|---|---|
| **Data** | Nothing goes into a database. Sample data is copied out of the mockup into JSON files, and those files are what every screen reads from for now. |
| **Logic** | Turn a raw number into money text like CHF 1'234.50, turn a raw date into a readable date, and serve one list of allowed values for every dropdown and chip. |
| **UI** | Build the layout of all 13 screens using the sample files. They look finished but are connected to nothing real. |

## Module diagram

```
  humans ──▶ UI  ─┐
                  ├──▶ routes ──▶ queries ──▶ database
  agents ──▶ CLI ─┘
```

```
┌─ UI ────────────────────────────────────────────────────────
│  components/**           13 screen layouts, from fixtures   new
│  lib/client.ts           the only fetch in the app          new
│  lib/mutations.ts        the only gated write hook          new
│  lib/format.ts           money and date rendering           new
└─────────────────────────────────────────────────────────────

┌─ CLI ───────────────────────────────────────────────────────
│  commands/books/books.go the command group                  new
│  client/books.go         wire types                         new
│  guide/topics/books/     route attribution reads this       new
│  commands/root.go        register the group      ALTERED, shared
└─────────────────────────────────────────────────────────────

┌─ BUSINESS LOGIC ────────────────────────────────────────────
│  lib/api.ts              appContext, four fields            new
│  lib/types.ts            public shapes for all 13 screens   new
│  lib/statements.ts       959a and 959b lines, French, code  new
│  app/api/meta/route.ts   the vocabularies                   new
└─────────────────────────────────────────────────────────────

┌─ DATA ──────────────────────────────────────────────────────
│  fixtures/*.json         the mockup's data as JSON          new
│  (no database in this phase)
└─────────────────────────────────────────────────────────────
```

**Platform packages: imported, never altered.**

| Package | Used for |
|---|---|
| `platform-api` | `apiHandler`, `resolveWorkspace`, `Errors`, `jsonList` |
| `platform-auth` | token verification inside `resolveUser` |
| `platform-db` | `platform.users` and the four sign in callbacks |
| `platform-ui` | design system primitives |

**Shared files this phase alters:** `cli/internal/commands/root.go`, and one row
in `platform.apps`. Nothing else outside `apps/books`.

## Build

### App skeleton

1. Copy `apps/_scaffold` to `apps/books`. Do not start from `apps/issues`.
2. Set the slug to `books` in six places: the directory, `lib/app.ts`, the
   Postgres schema, the `platform.apps` row, the CLI namespace, the guide topics
   folder. Nothing derives it from anything else.
3. Create the `books_app` role with `docs/sql/app-role.sql`.
4. Run `docs/sql/app-boundary-probe.sql` **as the app role**. `SET ROLE` from the
   owner gives the wrong answer.
5. Keep the scaffold's `middleware.ts`, `vercel.json`, `globals.css` and
   `drizzle.config.ts` unedited.

### Contract files

| File | What it holds |
|---|---|
| `lib/types.ts` | The public JSON shape for all 13 pages. Types only, no implementation. |
| `app/api/meta/route.ts` | The vocabularies, the entity list, the exercice list. |
| `lib/format.ts` | Money and date rendering. One helper, nowhere else. |
| `lib/client.ts` | The only `fetch(` in the app. `apiGet` and `apiSend`. |
| `lib/mutations.ts` | The only module that sends `apiSend` at a record path. One `useRecordMutation`, gated by `useCanWrite()`. |
| `lib/statements.ts` | `BILAN_STRUCTURE` and `CR_STRUCTURE` as code constants, French text, with article citations. |
| `fixtures/*.json` | The mockup's `bbooks-data.js` exported as JSON so the frontend renders real shaped rows. |

### The JSON is the contract, copy it exactly

`lib/types.ts` mirrors the mockup's structures **field for field**. The frontend
dev codes against these shapes, so renaming a field costs them a rewrite. When
in doubt, open `bbooks/assets/bbooks-data.js` in the `b-mockups` repo and copy what is there.

The four shapes that carry the most weight:

```jsonc
// entity
{ "id": 1, "slug": "blackcode", "name": "blackcode SA",
  "legal_form": "SA",                    // "SA" | "RI"
  "seat": "Chemin de la Roche 6, 1020 Renens VD",
  "bookkeeping_regime": "double_entry",  // "double_entry" | "simplified"
  "fiscal_year": "calendar", "exercice": 2026,
  "vat_registered": true, "vat_method": "effective", "vat_filing": "quarterly",
  "vat_note": null, "regime_note": null,
  "audit_status": "opted_out", "fte_count": 4.6,
  "accent": "#e8b84b" }

// account
{ "no": "1020", "class": 1,
  "label": { "fr": "Banque WIR", "en": "WIR bank" },
  "statement": "bilan",                  // "bilan" | "cr"
  "statement_position": "tresorerie",
  "related_party": false }

// transaction
{ "id": 1002, "entity_id": 1, "date": "2026-01-05",
  "status": "posted",                    // "posted" | "staged"
  "source_id": 501,
  "raw_label": "WIR-PMT REF-88213 IMMOREGIE SA",   // never overwritten
  "counterparty": "IMMOREGIE SA",
  "explanation": { "fr": "...", "en": "..." },
  "lines": [ { "account": "6000", "debit": 1850, "credit": 0 },
             { "account": "1020", "debit": 0, "credit": 1850 } ],
  "recognition": "known_recurring", "matched_rule_id": 101,
  "evidence_tier": "full",               // "full" | "partial" | "bare"
  "evidence_note": null,
  "tva": { "rate": 0, "amount": 0, "input_claimed": false, "note": {} },
  "related_party": null,
  "piece": { "drive_ref": "drive://bbooks/blackcode/2026/loyer-2026-01.pdf",
             "hash": "sha256:2f8a…c41e", "captured": "2026-01-05" },
  "history": { "fr": "...", "en": "..." } }

// recognition rule
{ "id": 101, "entity_id": 1, "source_id": 501, "active": true,
  "source": "contract",                  // "contract" | "subscription" | "manual"
  "pattern": { "counterparty": "IMMOREGIE", "amount_chf": 1850,
               "tolerance_chf": 0, "interval": "monthly" },
  "explanation": { "fr": "...", "en": "..." },
  "account": "6000", "created_from": 1001, "created": "2026-01-06",
  "note": { "fr": "...", "en": "..." } }
```

**The two derived shapes**, which the bilan and compte de résultat screens render
directly. These are what the derivations return, not what is stored:

```jsonc
// GET .../bilan  → what bilanFor returns
{ "groups": [
    { "group": { "fr": "Actif circulant", "en": "Current assets" },
      "side": "actif",                       // "actif" | "passif"
      "lines": [
        { "pos": "tresorerie",
          "label": { "fr": "Trésorerie", "en": "Cash & equivalents" },
          "related": false,   // true → art. 959a al. 4, present separately
          "derived": false,   // true → resultat_exercice, computed not posted
          "amount": 63700 } ] } ],
  "totalActif": 112333.03, "totalPassif": 112333.03, "resultat": -4200 }

// GET .../compte-resultat  → what crFor returns
{ "lines": [
    { "pos": "produits_nets",
      "label": { "fr": "Produits nets des ventes et prestations", "en": "..." },
      "sign": 1,                    // +1 income, -1 expense
      "amount": 21680,
      "accounts": ["3400"] } ],     // drives the drill-down link to the ledger
  "resultat": -4200 }
```

Three rendering rules that fall out of these shapes:

- **Zero amount lines are present and must render.** The legal line list is
  fixed, so a line with `amount: 0` is shown, not dropped. It may be visually
  collapsed, never absent.
- **`accounts` is what makes the compte de résultat drill down** into
  `?account=NNNN` on the ledger. Keep the array even when it has one member.
- **`totalActif` must equal `totalPassif`.** Render the check on the page. If it
  ever disagrees, that is a bug worth showing rather than hiding.

**Three things about these shapes that are easy to get wrong.**

1. **`label` on accounts is `{fr, enSuffix}` in the mockup, not `{fr, en}`.** That
   is a mockup shortcut. **Normalise it to `en` in the API** and say so in a
   comment, so the frontend never meets two spellings of the same idea.
2. **The vocabularies carry presentation data.** `RECOGNITION` and
   `EVIDENCE_TIERS` each carry a `color`, `SOURCE_TYPES` carries an `icon`, and
   `EVIDENCE_TIERS` carries a legal `note`. Serve all of it from `/api/meta`. The
   chips take their colour from the API, not from CSS, so a new state does not
   need a frontend release.
3. **Optional fields are absent or `null`, never empty strings.** `piece` is
   `null` or the object. `evidence_note` only appears when the tier is `partial`
   or `bare`. Type them as nullable rather than optional.

### The vocabularies

Eight lists, used by almost every page. They belong in `/api/meta` — read with
`bk meta --app-server books` — never in a component or a help string.

> **Corrected 2026-08-20.** This plan said `bk books meta` in seven places and
> that command was never built, correctly. `meta` is the command that WRITES the
> app registry, and every `bk books …` command RESOLVES its server through that
> registry (`cmdutil.ServerForApp`, which by design never guesses), so an
> app-owned spelling could not run in the one state it is most needed in: a
> config that has no address for books yet. `--app-server books` asks this
> deployment for one invocation and leaves the config alone.

`RECOGNITION`, `EVIDENCE_TIERS`, `TX_STATUS`, `SOURCE_TYPES`, `SOURCE_LAYERS`,
`SOURCE_STATUS`, `MANIFEST_STATES`, `TVA_RATES`

### CLI scaffolding

Not optional, and not deferrable. The parity test asserts that at least one
command is **attributed** to this app, and attribution comes from the guide
section list. Without these four pieces the test fails before you have written a
single real route.

| Piece | Path |
|---|---|
| The command group | `cli/internal/commands/books/books.go`, exporting `NewGroup()` and `const Slug = "books"` |
| Registration | add `books.NewGroup()` to the group list in `cli/internal/commands/root.go` |
| Guide topics folder | `cli/internal/guide/topics/books/`, with at least one topic file. **Route attribution reads this directory.** |
| Typed client | `cli/internal/client/books.go`, holding the wire types |

The group pins its app server, so `bk books ...` always talks to the books
deployment regardless of `bk app use`. That comes for free from `root.go`.

No `meta` command this phase: `GET /api/meta` is already claimed by the bare
`bk meta`, and mounting this app's route is what puts books into that claim's
parity scope. See the correction above, and the header of
`apps/books/app/api/meta/route.ts`.

Also mount the workspace reads from the scaffold, so `bk books workspace use`
works: `list`, `show`, `use`. Do not mount workspace create, edit or delete.

## Done when

- [ ] `npm run build`, `lint`, `typecheck`, `test` all pass
- [ ] the parity test passes (one route, one command)
- [ ] the boundary probe returns `42501` on every deny
- [ ] the frontend dev renders a Bilan layout from fixtures with real chips

## Frontend gets

Shapes, vocabularies, formatting, and fixtures. Enough to build every page
layout. Zero pages with live data, and that is expected.

## Notes

**Money crosses the wire as a string.** A `numeric(14,2)` column arrives as
`"1234.50"`. Never decode it into a float or a `float64`, in TypeScript or in Go.
Rounding a rappen silently in an accounting system is the worst class of bug this
project can ship. Dates are the same: a Postgres `date` is `"2026-08-11"`, not an
instant, and parsing it into a timestamp puts it at midnight in some timezone.

**Money format.** The platform groups thousands with U+2019 (`’`). The mockup
uses an ASCII apostrophe (`'`). Phase 1's parity test compares strings against
the mockup, so pick one now and write it down.

**No i18n system.** UI and CLI are English. Statutory line names stay French
because they are the wording of art. 959a and 959b and the filed PDF must be
French. Those are about 40 constants, not a framework.

**Free text columns.** For the six columns that hold bookkeeping prose
(`explanation`, `category`, `evidence_note`, `notes_freeform`, `attribution_note`,
`history`), store `jsonb` holding `{en: "..."}` rather than `text`. Adding French
later is then a value change, not a migration across eight populated tables.

## Read before starting

- `apps/_scaffold/lib/app.ts` and `lib/api.ts`: what you own vs inherit
- `apps/_scaffold/app/api/README.md`: which shared factories are safe to mount
- `apps/sales/lib/read-only.test.ts`: the read-mostly UI arrangement to copy

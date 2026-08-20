# Statements, tax, analyses and compliance

Everything here is DERIVED at request time from the posted entries and the
year's opening balances. None of it is stored, so none of it can drift.

Related commands: `bk books bilan`, `bk books cr`, `bk books overview`, `bk books
patrimoine`, `bk books analytique`, `bk books category list`, `bk books category
create`, `bk books tax`, `bk books tax-params show`, `bk books analyse list`,
`bk books analyse show`, `bk books analyse record`, `bk books compliance list`,
`bk books compliance show`, `bk books compliance review`, `bk books verdict`.

```bash
bk books overview                              # every book, latest year
bk books bilan --entity acme --exercice 2026   # art. 959a, statutory order
bk books cr --entity acme --exercice 2026      # art. 959b, by nature
bk books cr --entity acme --by-month           # the same statement, month by month
bk books analytique --entity acme              # cost buckets and monthly flows
bk books tax --entity acme --exercice 2026     # VAT position + PM tax estimate
```

## Reading the statements

`balanced` on the bilan is the most important boolean in the app: actif equals
passif plus the result, exactly. If it is false, something is posted to an
account the book's chart does not carry, and `bk guide books/entries` says how
that happens.

The bilan's résultat and the compte de résultat's résultat are the same figure
by construction. If they ever disagree, stop and report it.

A simplified book has no balance sheet at all (art. 957 al. 2). `bilan` refuses
for one and cites the article rather than printing an empty statement;
`patrimoine` is the personal picture instead.

## `--by-month` is a reading aid, not a filing

`bk books cr --by-month` adds a column per month of the exercice and keeps the
annual total beside them, in ONE answer. The annual body is unchanged, so the
months and the year can never be read from two different moments, and the months
sum to the year exactly — it is the same derivation over a partition of the same
postings.

Two things to rely on. Every month of the exercice is present, a month with no
trading coming back as a full set of zero lines rather than being dropped: a
column that appears and disappears cannot be read across, and "no trading" and
"no data" are different answers. And the line structure is identical in every
column, so a line can be followed along the row.

**No column is filable.** Art. 959b defines the compte de résultat as the ANNUAL
statement; a month is not a legal reporting period. Use it to find where a year
went, never as something to hand to a fiduciary.

`by` takes no other value — anything else is refused rather than ignored, so a
misspelling fails instead of quietly serving the annual statement. A simplified
book is refused before the breakdown is reached, for the reason above: it has no
compte de résultat to break down.

## The tax snapshot

`bk books tax` serves the book's own cited parameters or an honest
`configured: false`; it never borrows another book's rates. The VAT position
appears only for a VAT-registered book. Both are set during onboarding — see
`bk guide books/starting-a-book`.

It is not a tax return and not a position tracked over time. It is the statutory
picture of one book and one year at the moment it was asked.

## Analyses — writing an answer back

```bash
bk books analyse record --entity acme --asked-by You --agent claude-code \
  --question "Can we afford a CHF 1500 salary from September?" \
  --verdict "Yes, with 6.9 months of runway left" \
  --figures '[{"label":"Runway after","value":"6.9 mois"}]' \
  --based-on '[{"label":"Trésorerie","value":"CHF 42 000","href":"..."}]'
```

This is the agent write-back door, and the record is **permanent**: no edit, no
delete. Its `based_on` snapshot records what was READ at answer time and is
never recomputed, because a stored answer that silently reflows is a different
answer. Re-asking a drifted question files a NEW record and both stand.

Question, verdict and labels accept either a plain string or a bilingual object.
Both shapes are legal at the door and both render.

## Compliance

The app computes no compliance judgment. The rules are published, an external
agent pass reads them and files structured verdicts, and the server enforces
exactly one consequence: a blocked entry refuses to post until a fresh verdict
clears it.

```bash
bk books compliance list
bk books compliance show vat-008
bk books compliance review vat-008 --approve       # the fiduciary's sign-off
bk books verdict 12 --verdict blocked --rules dt-001 \
  --resolves "attach the missing piece"
```

Reviews are permanent — there is no path back to draft — and rules are never
deleted, because a verdict may cite one forever.

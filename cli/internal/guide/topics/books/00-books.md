# b/books — what it is and how to drive it

b/books keeps **statutory bookkeeping** for any number of books. A *book* is one
legal entity's set of accounts: a company, or a person's self-employment
activity. A user creates as many as they need and nothing in the app assumes a
particular number.

The point of it is not that transactions are recorded. It is that every one of
them is **explained**: what the money was, why it moved, through which channel,
and where the proof is. Unexplained money is a worklist, never a buried column.

Related commands: `bk books entity list`, `bk books entity create`, `bk books
exercice list`, `bk books exercice create`, `bk books account list`, `bk books
entry list`, `bk books entry show`, `bk books entry declare`, `bk books entry
post`, `bk books bilan`, `bk books cr`, `bk books patrimoine`, `bk books
overview`, `bk books worklist`, `bk books rule list`, `bk books rule create`,
`bk books resolve`, `bk books source list`, `bk books source show`, `bk books
source create`, `bk books source import`, `bk books manifest`, `bk books piece
list`, `bk books piece ingest`, `bk books piece match`, `bk books analytique`,
`bk books analyse list`, `bk books analyse record`, `bk books category list`,
`bk books category create`, `bk books tax`, `bk books compliance list`,
`bk books compliance review`, `bk books verdict`, `bk books workspace use`.

## This app holds no intelligence, and that is the design

b/books stores legible records and derives statements. It does not decide what a
transaction means. **You do** — or the agent you are running does — and the app
remembers the decision so the next matching transaction is handled
automatically.

So there is no chat here, no in-app assistant, and no scenario buttons. You read
the data through these commands, reason outside, and write the conclusion back.

## Status: phase 5 — feature-complete for the MVP

The statutory core, recognition, the sources register, the pièces pipeline,
the bank door and posting, the management layer, and the compliance layer are
all here. What remains is deployment, not commands.

## Sources and pièces

```bash
bk books source list                  # completeness: current / stale / gap
bk books source show 1                # one source: pulls, runbook, windows
bk books manifest 8                   # every Drive file that source has seen
bk books piece list                   # the receipts inbox
bk books piece ingest --file out.json # what the Drive worker does, by hand
bk books piece match 3 --entry 12     # say what the document proves
```

Source status is COMPUTED from cadence against the last import and stored
nowhere, so nothing can flip a late source green by hand. The ingest door
re-validates every payload's arithmetic server-side and ignores the worker's
own verdict; a bad document lands STAGED and FLAGGED rather than refused,
because a bad sum is exactly what a human must see. Duplicates are flagged and
never dropped — a refund looks identical to a re-scan. Unmatched pieces sit on
the same worklist as unrecognized money, with candidate entries suggested by
amount and date; matching writes the entry's pièce reference and deliberately
leaves the evidence tier to you.

## The bank door, and money no feed delivers

```bash
bk books source import 2 --file releve.xml   # camt.053, parsed server-side
bk books entry declare --entity acme --date 2026-08-19 --amount 20.00 \
  --label "cash coffee" --account 6570 --contra 1020 \
  --explanation "team coffee, paid cash"     # the declared write path
bk books entry post 12                       # staged -> posted, after review
```

A statement lands whole or not at all: the file must reconcile to the rappen
(opening + lines = closing) or the import refuses naming every problem. Every
imported line converges on the bank's own reference, so overlapping statements
never double the book. Rules run AT ARRIVAL and mark matches `inferred` — the
machine suggests, a person resolves.

## The management view, and the agent write-back

```bash
bk books analytique                 # cost buckets + monthly flows, derived live
bk books category create --entity acme --key marketing \
  --label-en Marketing --accounts 6600     # custom buckets, one franc one bar
bk books tax                        # VAT position + PM tax estimates, cited
bk books analyse record --entity acme --asked-by You --agent claude-code \
  --question "..." --verdict "..." \
  --based-on '[{"label":"...","value":"..."}]'   # file an answer, permanently
```

An analysis is append-only: no edit, no delete, by grant. Its `based_on`
snapshot records what the agent READ at answer time and is never recomputed —
a drifted answer is re-asked into a new record and both stand. The tax
snapshot serves the book's own cited parameters or an honest "not configured";
it never borrows another book's rates.

## Compliance: rules, review, verdicts

```bash
bk books compliance list            # all 19 rules; DRAFT until reviewed
bk books compliance show vat-008    # trigger, logic, consequence, citation
bk books compliance review vat-008 --approve        # the fiduciary's sign-off
bk books verdict 12 --verdict blocked --rules dt-001 \
  --resolves "attach the missing piece"   # the Devil's Advocate's door
```

The app computes no compliance judgment: an external agent pass reads the
rules and files structured verdicts, and the server enforces exactly one
consequence — a `blocked` entry refuses to post until a fresh verdict clears
it. Reviews are permanent (there is no path back to draft) and rules are never
deleted: a verdict may cite one forever.

## The recognition loop

```bash
bk books worklist                        # what needs a human, with suggestions
bk books resolve 12 --explanation "office rent" --account 6000 \
  --rule-counterparty IMMOREGIE --rule-amount 1850   # explain it, teach a rule
bk books rule list                       # the remembered judgments
```

Resolve keeps the old state in history forever: a resolved row still shows
"was: unrecognized". A taught rule is keyed to the SOURCE the entry came
through, never the merchant name alone — the same name on an untracked card
stays unrecognized, which is what keeps the completeness signal honest.

The machine never applies a rule by itself. The worklist SUGGESTS, computed
live; a human or an agent resolves.

`bk books note`, the scaffold's placeholder entity, is gone. Phase 1 removed the
command and the table with it.

## Starting a book

```bash
bk books entity create --slug acme --name "Acme SA" --legal-form SA
bk books exercice create --entity acme --year 2026
```

Two steps, and both are required. `entity create` installs the Swiss PME chart of
accounts in the new book, because an account named on a posting line has to exist
for that book and a book with an empty chart accepts nothing. Those accounts are
then that book's own: editing one book's chart affects no other.

It does **not** open a fiscal year. Every statement and every entry is scoped to
one, so until `exercice create` runs, reads answer that the book has no exercice
and tell you the command.

The regime follows the legal form. A capital company keeps double-entry books at
any turnover (art. 957 al. 1 ch. 2 CO) and a sole proprietorship defaults to
recettes/dépenses under art. 957 al. 2, which has no balance sheet at all —
`bk books bilan` refuses for such a book and cites the article rather than
printing an empty statement.

## Tenancy

```bash
bk books workspace list
bk books workspace use <slug>     # sets THIS app's active workspace only
bk books member list
bk books invite send <email>
```

Membership is the whole access gate. `bk books workspace use` does not disturb
the workspace `bk sales` or `bk issues` is pointed at; the choice is stored per
app.

## What this app deliberately does not have

**No uploads.** Supporting documents live in Google Drive and b/books stores the
reference plus a hash, never the file. There is no `bk books upload`.

**No trash and no purge.** Accounting records carry a ten-year retention duty
(art. 958f CO). Nothing here can be hard-deleted, so there is no bin to empty.

**No editing a posted entry.** A correction is a reversing entry, and the
database enforces it (a trigger, not app code). Interpretation stays open:
`bk books resolve` works on posted entries for explanation and recognition, and
refuses only the account.

## Output and exit codes

`--json` and `--yaml` work here exactly as everywhere else. Amounts and dates are
printed as they arrive, as strings: an amount is `numeric(14,2)` and rounding one
through a float in an accounting tool is a bug, not a formatting choice.

See `bk guide platform/output-and-exit-codes`.

## Vocabularies

Recognition states, evidence tiers, VAT rates and every limit are served live by
`bk meta`. They change without a release of this binary, so this topic does not
list them.

# Feeds, imports, and the recognition loop

Money arrives through a registered source, lands unexplained, and is explained
once. Explaining it can teach a rule, and the rule handles the next one.

Related commands: `bk books source list`, `bk books source show`, `bk books
source create`, `bk books source edit`, `bk books source import`, `bk books
source record-pull`, `bk books source runbook-set`, `bk books worklist`, `bk
books resolve`, `bk books rule list`, `bk books rule create`, `bk books rule
deactivate`, `bk books entry post`.

```bash
bk books source create --entity acme --name "BCV compte courant" --type bank \
  --expected monthly --ledger-account 1020
bk books source import 1 --file releve-2026-04.xml
bk books worklist --entity acme
bk books resolve 14 --account 6000 --counterparty "IMMOREGIE SA" \
  --explanation "Loyer bureau, bail commercial" \
  --rule-counterparty IMMOREGIE --rule-amount 1850 --rule-interval monthly
bk books entry post 14
```

## The sources register

A source is any place money data comes from. Its status is COMPUTED from its
cadence against its last import and stored nowhere, so nothing can flip a late
source green by hand. `bk meta` carries the status values; `bk books source
show <n>` prints the day windows this source uses to reach one.

`source runbook-set` records how a feed is pulled by hand, as structured JSON.
Its `credential_ref` must be a REFERENCE (a vault address), never a credential;
the door refuses anything else.

## Importing a statement

`source import` lands the file **whole or not at all**. It must reconcile to the
rappen — opening balance plus the booked lines equals the closing balance — or
the import refuses and names the problem. It also refuses a statement carrying
no opening or closing balance, because a truncated export proves nothing.

**Two formats, and the file decides which.** A camt.053 announces itself and
states its own balances, so it needs nothing else. Anything else is read as a
**delimited export** — the CSV a card or a processor issues — and needs two
things:

```bash
bk books source mapping-set 2 --file yapeal-mapping.json
bk books source import 2 --file card-2026-06.csv --opening 0.00 --closing -440.65
```

The mapping says how to read that issuer's columns, established once from a real
export: there is no "CSV format", every issuer names its columns differently, so
it is kept as data rather than code. `--opening` and `--closing` are required
because such a file almost never carries balances, and without them nothing can
tell a whole file from half of one. They also catch the one thing no reader can
infer — whether a positive number means money in or money out.

## A card and the bank that pays it are the same money

Set the chain with `bk books source edit <card> --draws-from <bank>`. Then give
the card **its own account**, and the import refuses if it names the bank's:

```bash
bk books account create --entity acme --no 2100 --class 2 \
  --label-fr "Dettes cartes de crédit" --position autres_dettes_ct
bk books source edit 2 --ledger-account 2100
```

Four purchases on the card and one settlement on the bank describe the same
spend. Booked against the same account it is counted twice — and the bilan
balances either way, so nothing downstream shows it. With the card on its own
account, the purchases credit it, the settlement debits it, and it nets to what
is still outstanding. Resolve the settlement line to that account, never to an
expense: the expense was already booked, merchant by merchant.

Every imported line converges on the bank's own reference, so re-importing an
overlapping statement adds nothing: the second run reports the lines as already
known. That makes the import safe to re-run on a schedule.

Rules run AT ARRIVAL and mark matches `inferred`. **The machine never applies a
rule by itself.** An inferred line is a suggestion carrying the rule it matched;
a human or an agent still resolves it.

## The worklist

`bk books worklist` is everything needing a human: unexplained money, inferred
suggestions, and unmatched documents.

It is scoped to ONE book and ONE year, defaulting to the first book and the
latest year. With more than one book you must pass `--entity`, or you will see
one book's work and believe you are done.

## Resolving, and teaching

`resolve` is the first write and the pattern every later one copies: the old
state goes into `history` before anything changes, forever. A resolved row still
shows "was: unrecognized".

Adding `--rule-*` flags teaches a rule from the resolution. A taught rule is
keyed to the SOURCE the entry came through, never the merchant name alone — the
same name on an untracked card stays unexplained, which is what keeps the
completeness signal honest.

`resolve` also carries the VAT flags, and this is usually where VAT arrives: a
bank line lands with no rate, and the rate is known once somebody reads the
invoice behind it. See `bk guide books/entries`.

On a POSTED entry, resolve still sets explanation, counterparty, recognition and
the VAT claim. It refuses the account and the VAT rate — those are booked facts.

## Switching a rule off

A rule taught against the wrong fragment, or against an amount that has since
changed, keeps marking every future import and citing itself. `rule deactivate`
stops it.

The rule is not deleted and never will be: a posted entry may cite it for the
ten years the entry is kept, so what it already explained keeps its explanation
and only future imports stop seeing it. There is no reactivate — teaching it
again is one `resolve` away, and the new rule records what it was learned from.

## Posting

Everything lands STAGED. `entry post` is the gate from staged to posted, and
posted is immutable. Post deliberately after review, not as part of import.

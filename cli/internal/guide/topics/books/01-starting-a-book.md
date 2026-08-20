# Starting a book

Onboarding a real company is five steps, and skipping any of them leaves a book
that reads as working while answering nothing. Do them in this order.

Related commands: `bk books entity create`, `bk books entity edit`, `bk books
exercice create`, `bk books account list`, `bk books account create`, `bk books
tax-params set`, `bk books tax-params show`, `bk books opening set`, `bk books
opening list`.

```bash
bk books entity create --slug acme --name "Acme SA" --legal-form SA --seat "Renens VD"
bk books exercice create --entity acme --year 2026
bk books account create --entity acme --no 1021 --class 1 \
  --label-fr "Banque BCV" --position tresorerie
bk books entity edit --entity acme --vat-registered \
  --vat-method effective --vat-filing quarterly
bk books tax-params set --entity acme --canton VD --commune Renens \
  --ifd-rate 8.5 --cantonal-base-rate 3.3333 --cantonal-coefficient 155 \
  --communal-coefficient 78.5 --capital-tax-permille 0.6
bk books opening set --entity acme \
  --balance 1020=50000.00 --balance 2800=20000.00 --balance 2970=30000.00
```

## 1. The book, and the chart it arrives with

`entity create` installs the Swiss PME chart in the new book, because an account
named on a posting line has to exist for that book and a book with an empty
chart accepts nothing. Those accounts are then **that book's own**: editing one
book's chart affects no other.

The regime follows the legal form. A capital company keeps double-entry books at
any turnover (art. 957 al. 1 ch. 2 CO) and a sole proprietorship defaults to
recettes/dépenses under art. 957 al. 2, which has no balance sheet at all —
`bk books bilan` refuses for such a book and cites the article rather than
printing an empty statement.

## 2. The fiscal year

`entity create` does **not** open one. Every statement and every entry is scoped
to a year, so until `exercice create` runs, reads answer that the book has no
exercice and name the command.

## 3. The accounts the template does not carry

The template is a starting point, not a ceiling. A company with a second bank, a
WIR account or a card the template never heard of adds it with `account create`.

`--position` is the statutory line the account reports on. `bk books account
list` shows the positions this book already uses. Class and position must agree:
classes 1 and 2 are balance-sheet lines (art. 959a), 3 and above are
profit-and-loss lines (art. 959b).

There is no edit and no delete. Entries point at an account by number, and
renumbering one would rewrite an audit trail.

## 4. VAT registration and tax parameters

**Both are needed and neither is guessed.**

A book is not VAT-registered by default, and while it is not, the tax snapshot
serves no VAT position at all however the entries are booked. `entity edit
--vat-registered` is what turns it on, and it requires the reporting method and
period at the same time, because a position nobody can file is not worth
computing. A company that crosses the art. 10 LTVA threshold registers mid-life;
this is how it says so.

Tax parameters say where the company is taxed. Nothing in this app may assume a
canton, so until they are set the snapshot answers `configured: false` — which
is a real answer and is never filled in with a default, because a supplied rate
would be inventing somebody's tax bill. All five figures are required together:
four of five would be wrong invisibly.

They are configuration, so setting them again replaces them: a coefficient that
has been voted supersedes the one before it. A snapshot already taken is
unaffected, because it is derived at request time and stored nowhere.

## 5. The opening balance sheet

A real client arrives with figures from whatever kept the books before. This is
where they go in, and it happens **once per book**: only a book's FIRST fiscal
year may be typed. Every later year's openings are produced by closing the year
before it — see `bk guide books/year-end`.

`opening set` replaces the whole set in one transaction, never a line at a time,
because a balance sheet is one statement that must balance. An unbalanced set is
refused on the day it is typed rather than months later at the first close, and
the refusal names the difference.

Amounts are in the account's natural direction: an asset positive when the book
owns something, a liability positive when it owes. The retained-earnings account
goes negative for a carried-forward loss. Only balance-sheet accounts may carry
one — a trading year starts at zero by definition (art. 958 al. 2).

Pass `--file <balances.json>` for a full trial balance, or `-` to read it from
standard input:

```bash
bk books opening set --entity acme --file - <<'JSON'
[{"account":"1020","amount":"50000.00"},
 {"account":"2800","amount":"20000.00"},
 {"account":"2970","amount":"30000.00"}]
JSON
```

## What is still not reachable

A book's patrimoine (the net-worth statement for a sole proprietorship) has no
write door, and an invitation cannot yet be accepted, so a workspace stays
single-member. Neither blocks statutory bookkeeping.

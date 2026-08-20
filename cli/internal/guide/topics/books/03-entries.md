# Writing entries by hand, VAT, and corrections

Cash and private payments never cross a bank line, so no import will ever bring
them. A declaration is how they get in, and the declarer IS the explanation.

Related commands: `bk books entry declare`, `bk books entry list`, `bk books
entry show`, `bk books entry post`, `bk books resolve`, `bk books account list`.

```bash
# two sides — the common case
bk books entry declare --entity acme --date 2026-08-19 --amount 20.00 \
  --label "cash coffee" --explanation "team coffee, paid cash" \
  --account 6570 --contra 1020

# more than two sides — a salary
bk books entry declare --entity acme --date 2026-01-25 \
  --label "SALAIRES JANVIER" --explanation "January salaries, two employees" \
  --debit 5000=11600.00 --debit 5700=1750.00 --credit 1020=13350.00

# with VAT
bk books entry declare --entity acme --date 2026-02-10 --amount 83.20 \
  --label "SWISSCOM FACTURE" --explanation "Mobile, February" \
  --account 6570 --contra 1020 \
  --tva-rate 8.1 --evidence-tier full --tva-input-claimed
```

## Two sides, or many

`--account` (the charge) and `--contra` (what settles it) is the two-line
shorthand and the common case. There is **no caisse**, on purpose: a cash
business expense settles against the owner's compte courant, and the declarer
says which.

A salary is not that shape. `--debit account=amount` and `--credit
account=amount` are repeatable and give an entry as many sides as it needs. With
explicit lines the entry's amount is DERIVED from one side rather than asked
for, because asking would invite a total that disagrees with the lines it
totals.

Mixing the two forms is refused rather than merged: the declarer has to be able
to read back what they declared.

Every line must name an account **in this book's chart**. A posting to an
account the chart does not carry is invisible to every derivation and silently
unbalances the balance sheet, so both the door and a database trigger refuse it.
If the account is real but missing, add it — see `bk guide books/starting-a-book`.

Debits must equal credits. The refusal says which way and by how much.

## VAT on an entry

Available on `entry declare` and on `bk books resolve`, and usually used on the
latter: a bank line lands with no rate, and the rate is known once somebody
reads the invoice behind it.

`--tva-rate` is the rate as written on the invoice. The rate set is fixed by
law and served live by `bk meta`; anything outside it is refused.

`--tva-amount` is optional. Swiss prices are TTC, so the tax INSIDE a gross is
computed for you. Pass the invoice's own figure and it is kept, because a
supplier's figure is the better record — unless it disagrees with the
arithmetic by more than a rappen, which is a misread rather than rounding, and
is refused.

`--tva-input-claimed` requires `--evidence-tier full`: input tax may only be
deducted where it can be proved (art. 28 al. 1 LTVA). Claim it once the pièce is
on file, or attach the document first with `bk books piece match` and claim
afterwards.

On a POSTED entry the rate and the amount are frozen — they are booked figures —
while the CLAIM is not, because whether you deduct input tax legitimately moves
as evidence arrives. A recettes-dépenses journal records no per-entry VAT rate
at all and says so rather than dropping the flags silently.

## Simplified books

A book kept under art. 957 al. 2 has a recettes-dépenses journal instead of a
grand livre: no accounts, no posting status. Declare with `--direction` and an
amount, and resolve the same rows through the same worklist.

`--direction` takes THREE values, and the third one matters. A transfer between
the owner's own accounts is `neutral`: logged in the book, counted in neither
recettes nor dépenses. The case you will meet is a card. Its purchases arrive on
the card's own export and the bank shows one debit that settles them — both
files are true, and if the settlement is booked as a `depense` beside the
purchases it settles, the same money is an expense twice.

`resolve --direction` is how a direction gets corrected. An import can only read
the bank's credit/debit indicator, so it always guesses a side; only a person
knows a settlement from a payment. Omitting the flag leaves the side alone, like
every other field on `resolve`.

## Correcting a mistake

There is no un-post, no edit and no delete, and the refusals come from the
database rather than from app code. A correction is a **reversing entry**:
declare the opposite entry, explain it as the correction it is, and post it.
Both entries stand, which is the point — the trail shows what happened and what
was done about it.

Interpretation stays open on a posted entry: explanation, counterparty,
recognition and the VAT claim are all still settable through `resolve`.

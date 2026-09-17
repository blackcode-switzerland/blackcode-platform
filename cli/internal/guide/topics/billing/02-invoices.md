# Invoices

An invoice here is a **numbered legal document**, not a generated PDF. Its number
is permanent, it is never deleted, and every change to it is attributable to a
person or a token.

Related commands: `bk billing invoice list`, `bk billing invoice show`,
`bk billing invoice create`, `bk billing invoice edit`,
`bk billing invoice line set`, `bk billing audit list`,
`bk billing overview`.

## Addressing one

`<ref>` is either spelling:

```
bk billing invoice show 7              the #number — the address
bk billing invoice show BC-2026-0007   the printed number — the document
```

The `#number` is this app's own address space and appears in URNs
(`bc:billing:acme/invoice/7`). The printed number is what the client sees and
what goes into the payment reference. They are different numbers and both are
real; the server resolves `#number` first.

## Creating one

```
bk billing invoice create --company acme-sa \
  --client-name "Junod SA" --client-street "Av. de la Gare" \
  --client-building 3 --client-postal-code 1003 --client-city Lausanne \
  --client-country CH \
  --item "Consulting, October|12|days|132.50|8.1" \
  --item "Travel|1|forfait|180.00"
```

It arrives as a draft, numbered. **The number is consumed by this command and
cannot be reclaimed** — so a retry must not create a second bill, which is why
`create` sends an idempotency key automatically.

If you are driving this from a script, `--expect-total` is worth the one extra
field. When it disagrees with what this app derives, the invoice is **refused
and no number is allocated**, and the message names the company's rounding
policy and whether its prices include VAT. Those two facts explain almost every
disagreement between two billing systems.

## A line's VAT rate has three states, not two

This is the one thing in this app that is easy to get wrong and expensive to get
wrong.

| What you pass | What it means |
|---|---|
| nothing | inherit the company's or the invoice's default |
| `none` | **this line carries no VAT** — an exempt act, or a company not registered |
| `0` | a **real rate of zero** — an export, a reverse charge |
| `8.1` | that rate |

"Carries no VAT" and "rated at zero" appear differently on the document and
differently on a VAT return. One invoice may mix them: a VAT-exempt consultation
beside a taxable product is an ordinary Swiss bill.

The VAT block gets one line per distinct rate, on that rate's base only. A line
with no rate is in the subtotal and in no VAT line.

## Editing, and what freezing means

While it is a draft, everything is editable.

Once it is **sent**, the document half is frozen: the amounts, the lines, the
client, the currency, the reference and the issue date. A refusal names which
field you touched.

What stays editable is the part that is not a legal fact — the payment message,
the due date, your own reference and your own metadata. A correction to anything
else is a **void plus a reissue**, which is how a paper invoice works too.

## Replacing the lines

```
bk billing invoice line set 7 \
  --item "Consulting, October|12|days|132.50|8.1" \
  --item "Travel|1|forfait|180.00"
```

There is no `line add` and that is deliberate. A line's position is display
order, so a partial update has to answer "what happens to the gap?" every time
one is removed. Replacing the set makes the order your statement.

The log still records it line by line — one entry per changed field, spelled
`items[2].unit_price` — so "what changed?" has an answer.

## The log is the history, and also a feed

Every write appends to the log in the same transaction as the change, so a change
with no entry is impossible. Nothing in it is ever updated or deleted.

```
bk billing audit list --subject invoice:7    one invoice's history
bk billing audit list --since 412            everything since that cursor
```

Without a cursor the newest entry is first. **With one, entries come back
ascending from it** — because a descending feed would make a poller re-read the
same page forever. Store the last number you saw and pass it back; the sequence
is allocated under a lock, so nothing can appear below a cursor you have passed.

Humans and agents land in the same log. `via` is the only difference.

## Money is per currency, and never added up

`bk billing overview` reports each currency separately and prints no grand
total. Adding CHF to EUR produces a number that is not money in any currency.

`overdue` is a subset of `outstanding`, not a third bucket. A draft counts toward
neither — nobody owes an unsent bill — and a void counts toward nothing at all.

## After the draft

Sending, marking paid and voiding are `bk guide billing/sending-and-status`. Once
an invoice leaves draft its document half is frozen, and the only correction is a
void plus a new invoice.

The payment reference check digit, the QR code and the PDF are not built yet;
`bk billing invoice pdf` does not exist.

Vocabularies and limits are served live by `bk meta --app-server billing`, so
nothing on this page lists them.

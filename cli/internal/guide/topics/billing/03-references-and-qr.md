# References, the QR code and the PDF

An invoice becomes a document when you ask for one. Nothing is stored: the PDF
and the QR payload are computed from the record each time, by one piece of code,
so what you fetch, what is emailed and what the screen shows cannot disagree.

Related commands: `bk billing invoice pdf`, `bk billing invoice qr`,
`bk billing invoice show`, `bk billing invoice send`.

## The reference is derived, never typed

An invoice stores the BODY of its payment reference and never its check digits.
The full reference is computed on every read, and `bk billing invoice show`
prints it as it appears on the bill. You do not supply either half: the body is
generated when the invoice is created.

Which kind of reference an invoice carries decides which of the company's two
accounts it settles on. A QR reference settles on the QR-IBAN; everything else
settles on the ordinary IBAN. `invoice show` prints the account as `Pay to`, so
you can see where the money will go before anyone is asked for it.

Run `bk meta --app-server billing` for the reference types themselves. The
combinations the standard forbids are refused when the invoice is written, not
when it is sent — `bk guide billing/pitfalls` has the one people hit.

## Fetch the PDF before you send

```
bk billing invoice pdf <ref>                 writes ./<number>.pdf
bk billing invoice pdf <ref> --out bill.pdf
bk billing invoice pdf <ref> --out - | lp    bytes on stdout, never to a terminal
```

**`invoice pdf` is the dry run for `invoice send`.** Both go through one check
against the QR-bill standard, and both refuse for the same reasons — so a PDF
that renders is a bill that can be mailed, and a refusal here costs nothing.

The refusal is `payment_part_invalid`, and it names **every** problem at once: a
company address with no town, a bill that needs a QR-IBAN the company does not
have, a character a Swiss QR Code cannot carry. `invoice show` lists the same
problems under the totals without fetching anything.

It will not overwrite a file without `--force`. The file in the way may be the
copy somebody sent.

## What the PDF contains

The A4 invoice in the DOCUMENT's language — the invoice's own `language`, not
yours — and, at the foot of the last page, the payment part with its QR code.

Three cases have no payment part, and none of them is an error:

- **a currency the QR-bill does not carry.** The invoice still renders; it is a
  valid bill with no slip. `invoice show` says so on its `Pay to` line.
- **a void invoice.** It renders, stamped, with the payment part removed. A
  cancelled bill that could still be scanned and paid is the one PDF this app
  could produce that moves money by mistake.
- **no client address.** The slip is drawn with an empty box for the payer to
  fill in by hand, which is the standard's own answer to an unknown debtor.

## The same invoice is the same bytes

The render is deterministic, so `invoice pdf` prints the sha256 of what it wrote
and tells you how it relates to what was sent:

| It says | It means |
|---|---|
| byte for byte the PDF that was emailed | this file IS what the client received |
| NOT the bytes that were emailed | the payment message or the due date was edited since. Nothing else on a sent invoice can change |
| issued outside this app | it was recorded with `mark-sent`, so no emailed copy was fingerprinted |
| a DRAFT | it can still change until it is sent |

`--json` carries the same facts as `sha256`, `sent_sha256` and `matches_sent`.
`matches_sent` is null, not false, when there is nothing to compare against.

## The issuer is copied at issue

A draft renders from its company **as it is now**. The moment an invoice leaves
draft it takes its own copy of the company — names, address, both accounts, VAT
identity, footers, rounding policy — and renders from that copy from then on.

So correcting a company reaches its drafts and its future bills, and never a
bill that already went out: not its account, not its creditor name, not its
totals. `invoice show` prints the copy on its `Issuer` line, and `-o json` has it
whole as `issuer` (null on a draft).

If a sent bill carries the wrong account, the fix is the usual one: void it with
a reason and issue a new one.

## The payload, for a validator or a diff

```
bk billing invoice qr <ref>
bk billing invoice qr <ref> | pbcopy
```

This prints exactly the text the PDF's QR code encodes — same function, same
validation. It exists because SIX's validation portal takes a pasted payload, and
because it is the cheapest way to check your own work.

**Every element is identified by its line number. There are no keys.** An empty
line is content, so the output is written untouched: no newline is added at the
end and none of the empty lines is dropped. Do not trim it, and do not let an
editor tidy it — a payload with one line missing still scans, and carries the
wrong reference.

It refuses with `no_payment_part` where there is no slip (the first two cases
above), and with `payment_part_invalid` where `invoice pdf` would.

## Characters a QR code cannot carry

The standard permits Latin letters with their accents and ordinary punctuation,
and nothing else. The one people hit is typographic: an em dash, a curly quote or
an emoji in the payment message — often put there by the keyboard, not the
person. The write is refused when you make it, naming the character and its
position, rather than at send time.

Nothing is substituted for you. A creditor name that was quietly altered can stop
matching the account holder, and a message that was quietly altered is one nobody
approved. Line descriptions are not affected: they are printed, never encoded.

# Companies, and the number that cannot be changed

A **company** is the entity a bill comes from: its name, its address, its bank
account. A workspace bills from as many as it has, and each one keeps its **own
invoice sequence**.

That sequence is the thing to understand before anything else here. It is
contiguous with no holes and no reuse, per company, forever.

Related commands: `bk billing company list`, `bk billing company show`,
`bk billing company create`, `bk billing company edit`,
`bk billing company retire`.

## Why the sequence matters more than it looks

Swiss bookkeeping requires an invoice sequence with no gaps. A missing number is
indistinguishable, to anyone reading the books later, from a bill that was issued
and then hidden — so a gap is a finding rather than an untidiness.

Three consequences you will meet:

- **Creating an invoice consumes a number permanently.** There is no undo. A bill
  you did not mean is voided with a reason, and it keeps its number.
- **Voiding does not free the number.** Nothing decrements the sequence.
- **Creating invoices for one company is serialised.** Two at the same instant
  wait for each other. That is the price of the guarantee, and it is deliberate.

`company show` prints the next number the company will issue. It is read-only on
every surface: the only thing that moves it is creating an invoice.

## One setting is read when a total is derived, not when the invoice is created

Everything under `defaults` is a prefill for new invoices, `prices-include-vat`
included: each invoice stores its own price mode. **`rounding`** — how
five-rappen rounding is applied — is the exception.

Nothing stores a total. Every total is derived from the lines, the invoice's
price mode and the rounding policy on every read, so **changing `rounding`
re-totals every draft that company has, at once.** `company edit --rounding`
says so and points you at a draft to check.

It does not reach an invoice that already left draft. That one carries its own
copy of the company — rounding policy, names, address, accounts — and totals
under the policy it was issued with. `bk guide billing/references-and-qr` has
what else that copy protects.

Run `bk meta --app-server billing` for the policies and what each one does.

## The legal name is not the display name

`--legal-name` is what goes on the payment part, and it **must match the holder
of the credit account**. A mismatch is a bill a bank may refuse — not a
cosmetic problem.

It defaults to `--name`, which is right for most companies. Set it separately
when the trading name and the registered name differ.

## The IBAN fields are owner-only

Changing an IBAN redirects real money, and the bill looks entirely normal
afterwards. So only the workspace owner may set `--iban` or `--qr-iban`; a
member creating a company leaves them off and the owner adds them.

A company with no IBAN can hold invoices and cannot produce a payment part.
`company create` says so when that is the state it left you in.

## There is no company delete

A company is **retired**: it stops being offered for new invoices and still
renders its old ones. Past invoices reference it, and a statement for a past year
has to render.

`company retire` makes you repeat the slug back with `--confirm`, because
confirmation prompts auto-approve for agents and on a non-TTY.

## Starting a company

```
bk billing company create \
  --slug acme-sa --name "Acme SA" \
  --legal-name "Acme Société Anonyme" \
  --street "Rue du Rhône" --building 14 \
  --postal-code 1204 --city Genève --country CH \
  --vat-registered --uid CHE-123.456.789 \
  --number-format "AC-{YYYY}-{SEQ4}"
bk billing company show acme-sa
```

`{SEQ4}` is required in a number format: without it every invoice from that
company would carry the same number. `{YYYY}` is the issue year and is display
only — the sequence does not restart when the year changes.

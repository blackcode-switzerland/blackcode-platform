# Sending, paid and void

An invoice starts as a draft and leaves it exactly once. What it becomes, and the
record that says how, is what this topic is about. None of these four commands
can be undone.

Related commands: `bk billing invoice send`, `bk billing invoice mark-sent`,
`bk billing invoice paid`, `bk billing invoice void`,
`bk billing audit list`.

## The machine

A draft becomes sent, a sent bill becomes paid, and any bill can be voided. Run
`bk meta --app-server billing` for the status values themselves.

Nothing goes backwards. A sent bill cannot return to draft, because the client
already holds it; a voided one cannot be revived, because its number is consumed.
The database enforces this, not the CLI, so no other client can walk around it.

## Once it is sent, the document is frozen

The amounts, the lines, the client, the currency, the reference, the document
language and the issue date are refused on any invoice that is not a draft. The
due date, the payment message, your `external_ref` and `metadata` stay editable,
because they are not part of what the client holds.

**A correction is a void plus a new invoice.** There is no other way to change
what a sent bill says, and that is the point.

## Emailing it

```
bk billing invoice send 7 --to accounts@client.ch
bk billing invoice send 7 --to accounts@client.ch --cc owner@client.ch \
  --subject "Invoice October" --body-file note.txt
```

The mail carries the PDF. It is sent under this app's name from the platform's
verified address, with **reply-to set to the issuing company's email** — so the
company needs one first (`bk billing company edit <slug> --email …`), and a
client who replies reaches the company.

Without `--subject` and `--body` the mail is written in the invoice's **document
language**, naming the number, the amount and the due date. Use `--body-file` or
`--body -` for a multi-line note; a newline inside a flag value is where shells
disagree.

What is recorded: the moment, the email's message id, and the sha256 of the exact
PDF bytes attached. `bk billing invoice show 7` prints all three, and one audit
entry names the recipients and the message id.

Before anything is rendered, the invoice must be ready: at least one line, a
client name, a positive total, an account to be paid into, and a company that
has not been retired. A refusal names which, with the command that fixes it.

### When send refuses, what is left behind

| Code | What happened | What to do |
|---|---|---|
| `email_not_configured` | this deployment cannot send email. Nothing was read or written | deliver it yourself, then `mark-sent` |
| `payment_part_invalid` | the record would make a payment part a bank rejects. Nothing was written, and every problem is named | fix what it names; `bk billing invoice pdf` is the dry run |
| `email_delivery_failed` | the mail was refused. The invoice is still a draft | fix the address, send again |
| `delivered_not_recorded` | the mail **went**, and recording it failed | **do not send again**; `mark-sent` |

`mark-sent` refuses with `payment_part_invalid` too. Once an invoice is sent its
document is frozen, so one that could not render at that moment never could.

Leaving draft — by either command, or by voiding a draft — is also the moment
the invoice takes its own copy of the issuing company.
`bk guide billing/references-and-qr` has what that copy protects.

On a development deployment with no email key, a send completes **without
delivering** — the server log shows what would have gone, the invoice carries no
message id, and the command says so in capitals. That exception does not exist in
production, where the same request is `email_not_configured`.

## Sent some other way

```
bk billing invoice mark-sent 7
```

For paper, somebody's own mailbox, or a hand delivery. The invoice becomes sent
with **no message id and no fingerprint**, and those empty fields are the
permanent record that this app did not deliver it. The same readiness checks
apply.

## Paid

```
bk billing invoice paid 7 --date 2026-10-02
```

**An assertion, not a reconciliation.** Nothing here watches a bank account or
compares an amount; it records the date you give it. `--date` is required rather
than defaulting to today, because the day you run this is rarely the day the
money landed, and it may not be in the future. Only a sent invoice can be marked
paid.

## Void

```
bk billing invoice void 7 --reason "Issued to the wrong entity" --confirm BC-2026-0007
```

`--reason` is required; one reason serves both languages, or pass `--reason-fr`
and `--reason-en`. The record keeps who voided it, when and why, and the number
stays consumed forever — the next invoice takes the following number, never this
one.

`--confirm` must repeat the invoice's **printed number** exactly, and it is
required **even with `--yes` and even under `BK_NO_PROMPT=1`**. The command reads
the invoice first and compares against its real number, so `void 7 --confirm 7`
is refused. A wrong or missing `--confirm` exits 2, the same code the server's own
refusal maps to.

## Retrying safely from a script

Every command here takes `--idempotency-key`. Pass an identifier of your own
request — an order id, an appointment id — and running the same command again
with the same key replays the first answer instead of acting twice. For `send`
that is the difference between one bill in a client's inbox and two. Without the
flag, every run is a new request.

## Watching for these from outside

`bk billing audit list --since <seq>` returns entries in order from a cursor, so a
poller learns what somebody did in the browser; `bk meta --app-server billing`
lists the actions an entry can carry. A send entry with no message id was
recorded, not delivered. Each entry names its subject by `#number`
(`subject_seq`) and carries the subject's own `external_ref`
(`subject_external_ref`), so an event maps straight to your record.

# b/billing — what it is and how to drive it

b/billing issues **Swiss invoices**: an issuing company, a numbered bill, and a
QR-bill payment part a bank will accept. A *workspace* is a tenant; the company
that issues a bill is a row inside it, so one tenant bills from as many entities
as it has.

What makes it different from a document generator is that a bill here is a legal
record. Its number is contiguous with no holes, it is never reused, it is never
deleted, and every change to it is attributable to a person or a token.

Related commands: `bk billing workspace list`, `bk billing workspace use`,
`bk billing workspace create`, `bk billing member list`, `bk billing invite
send`, `bk billing invite list`, `bk billing invite revoke`.

## Phase 0: only tenancy exists today

This deployment is registered and answering, and it holds nothing but its own
workspaces, their members and their invitations. **Companies and invoices are
not built yet.** If you are looking for `bk billing invoice`, it does not exist
and you have not mistyped it.

What arrives next, in order: companies, invoices, line items and the audit log;
then the payment reference, the QR payload and the PDF; then sending, paid and
void; then recurrence; then imported history. `docs/billing-app-plan/` in the
repo is the plan, one document per milestone.

## Start here

```
bk login --server https://billing.blackcode.ch
bk billing workspace list
bk billing workspace use <slug>
bk billing member list
```

`bk login` opens a page in your browser and mints one **blackcode-wide** token.
It is not a billing token: the same string reaches every app your account can
reach, and you can revoke it from any of them with `bk token revoke`.

## Each app remembers its own active workspace

`bk billing workspace use x` sets the active workspace for **this app only**. It
does not move `bk issues`, `bk sales` or `bk books`.

That is not a convenience. Two apps' workspace tables have overlapping ids, so
one shared setting meant selecting a workspace in one app silently retargeted
the others — a command that then succeeded against the wrong tenant. The CLI
keys the active workspace by app slug for that reason.

## Creating and not deleting

```
bk billing workspace create --name "Acme SA"
```

Use this for a genuinely separate tenant. It is **not** how you add a second
entity to bill from — that is a company inside an existing workspace, and it
arrives in phase 1.

There is deliberately no `bk billing workspace delete`, and there will not be
one. A workspace holds invoices, and an invoice carries a ten-year retention duty
under art. 958f CO. The same reasoning keeps `trash` and `label` off this app
entirely: a bill is voided with a reason, never binned, so there is no
soft-deleted state to list and no purge path to expose.

## Inviting somebody

```
bk billing invite send --email someone@example.com
bk billing invite list
bk billing invite revoke <id>
```

**The invitation cannot be accepted yet.** There is no accept route in this app,
so `invite send` records an offer and returns its link, and nothing can redeem
it. That is stated here rather than discovered: a command that reports success
against a flow with no other end is the kind of thing an agent builds on and
then cannot explain.

Until it lands, a workspace somebody creates is theirs alone.

## What is served live, and why this page does not list it

Run `bk meta --app-server billing` for the vocabularies and the limits. They
change without a release of this binary, so nothing in this guide restates them
— a page listing them is confidently wrong the first time one changes, with
nothing to say so.

`--app-server billing` asks this app for one invocation and changes nothing about
your config. `bk meta` on its own answers from whichever app your config is homed
on, and one deployment cannot answer for another.

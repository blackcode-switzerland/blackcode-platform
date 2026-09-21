# b/billing — what it is and how to drive it

b/billing issues **Swiss invoices**: an issuing company, a numbered bill, and a
QR-bill payment part a bank will accept. A *workspace* is a tenant; the company
that issues a bill is a row inside it, so one tenant bills from as many entities
as it has.

What makes it different from a document generator is that a bill here is a legal
record. Its number is contiguous with no holes, it is never reused, it is never
deleted, and every change to it is attributable to a person or a token.

Related commands: `bk billing workspace list`, `bk billing workspace use`,
`bk billing workspace create`, `bk billing workspace edit`,
`bk billing workspace transfer`, `bk billing workspace delete`,
`bk billing member list`, `bk billing member remove`, `bk billing invite send`,
`bk billing invite list`, `bk billing invite revoke`,
`bk billing invite candidates`, `bk billing invite pending`,
`bk billing invite show`, `bk billing invite accept`,
`bk billing invite decline`.

## What exists today

Companies, invoices with their lines, the audit log, the lifecycle — sending a
bill by email, recording one that went out another way, marking it paid, and
voiding it with a reason — and the imported archive of bills from the systems
this app replaces. `bk guide billing/companies-and-numbering`,
`bk guide billing/invoices`, `bk guide billing/references-and-qr`,
`bk guide billing/sending-and-status`, `bk guide billing/recurrence` and
`bk guide billing/imported-history` cover them. **Read
`bk guide billing/pitfalls` before your first write**: every mistake in it looks
like a success from the inside.

 `docs/billing-app-plan/` in the repo is the plan, one
document per milestone.

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

## Your first workspace

Opening the dashboard in a browser gives you a workspace of your own if you have
none — signing in on another blackcode app and coming here is enough. From the
CLI, `bk billing workspace list` shows what you have.

## Creating, renaming, handing over

```
bk billing workspace create --name "Acme SA"
bk billing workspace edit --name "Acme Holding SA"
bk billing workspace transfer --to <user_id>
```

Create a workspace for a genuinely separate tenant. It is **not** how you add a
second entity to bill from — that is a company inside an existing workspace
(`bk billing company create`).

`edit` changes the name only. The slug is fixed: it is part of every URN this app
has printed, and those live in other systems. `edit --slug` is refused with
`slug_immutable`.

`transfer` needs the new owner's user id (`bk billing member list` shows it), and
they must already be a member. You stay in the workspace as a member.

## Deleting — only a workspace nothing was issued from

```
bk billing workspace delete <slug> --confirm <slug>
```

This succeeds only for a workspace that has never had a company, invoice,
recurring series, imported bill or audit row — a tenant made by mistake. Any
other workspace is refused with `workspace_retained` and the counts that caused
it: an invoice and its records carry a ten-year retention duty under art. 958f
CO, and the database refuses the delete for everybody, owners included. Retire
its companies (`bk billing company retire`) or hand it over instead.

The same reasoning keeps `trash` and `label` off this app entirely: a bill is
voided with a reason, never binned, so there is no soft-deleted state to list and
no purge path to expose.

## Members and invitations

```
bk billing invite send someone@example.com
bk billing invite candidates            # people you already share a workspace with
bk billing invite list
bk billing invite revoke <id>
bk billing member remove <user_id>      # owner only — or your own id, to leave
```

`invite send` emails a link to this app's `/invitations/<token>` page and prints
the link too; `email_sent: false` in `-o json` output means the email did not go
and you should pass the link on yourself. The invitee accepts in the browser or
with:

```
bk billing invite pending               # invitations addressed to your email
bk billing invite show <token>          # who invited you, and where
bk billing invite accept <token>
bk billing invite decline <token>
```

They must be signed in as the address the invitation was sent to; holding the
token is not enough. The owner cannot be removed and cannot leave — transfer the
workspace first. Invoices a removed member created stay, attributed to them.

## What is served live, and why this page does not list it

Run `bk meta --app-server billing` for the vocabularies and the limits. They
change without a release of this binary, so nothing in this guide restates them
— a page listing them is confidently wrong the first time one changes, with
nothing to say so.

`--app-server billing` asks this app for one invocation and changes nothing about
your config. `bk meta` on its own answers from whichever app your config is homed
on, and one deployment cannot answer for another.

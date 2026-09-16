# b/billing — changelog

This file is an **agent** surface. It is merged into `bk changelog` and
`GET /api/changelog` from `packages/platform-agent/src/changelog.ts`, newest
entry first, so an agent can keep an integration current without reading the
repo. Say what changed, whether it is breaking, and how a client should adapt.

## 2026-09-17 — b/billing exists: the app is registered, migrated and answering

**Not breaking.** A new app. Nothing that worked before behaves differently.

`billing` is registered in `platform.apps` and serves at
`https://billing.blackcode.ch`. It owns its own tenancy and nothing else yet.

**What you can do today**

    bk login --server https://billing.blackcode.ch
    bk billing workspace list
    bk billing workspace create --name "Acme SA"
    bk billing workspace use <slug>
    bk billing member list
    bk billing invite send --email someone@example.com
    bk billing invite list
    bk billing invite revoke <id>

`bk guide billing` is the topic; `bk meta --app-server billing` carries the
vocabularies and limits.

**What you cannot do yet, and should not code against**

There are no companies, no invoices, no line items and no audit log. If you are
looking for `bk billing invoice`, it does not exist and you have not mistyped
it. Those arrive in phase 1, with their routes and commands in the same change,
and they get their own entry here.

**Two behaviours worth knowing now**

- **`bk billing workspace use` is scoped to this app.** It does not move
  `bk issues`, `bk sales` or `bk books`. Two apps' workspace tables have
  overlapping ids, so one shared setting would mean selecting here silently
  retargeted the others.
- **An invitation cannot be accepted yet.** `invite send` records the offer and
  returns its link; no route redeems it. `invite list` and `invite revoke` work.
  Until the accept flow lands, a workspace somebody creates is theirs alone.

**Deliberately absent, and permanently**

`bk billing trash`, `bk billing label`, `bk billing upload`,
`bk billing storage`, and `workspace delete`. An invoice is voided with a
reason, never binned — the void is a record and the number stays consumed — so
there is no soft-deleted state to list and no purge path to expose. Art. 958f CO
imposes a ten-year retention duty on invoices, and a workspace holds them.

**Assumptions this app ships with**

Nine of the mockup's open questions were answered provisionally so code could be
written, each recoverable at a stated cost, and they are in
`docs/billing-app-plan/README.md`. Five remain open and gate the first real
invoice: a real second legal entity, blackcode's real UID and IBANs, the
ESTV-verified VAT rates, and the QRR reference scheme agreed with the bank.

**One recorded deviation.** The brief asked for invoices sent from Gmail. They
will be sent through Resend, on the platform's verified domain, because there is
no Google credential anywhere on this platform and acquiring one to send mail is
a security surface the platform does not have. Decision D-B3.

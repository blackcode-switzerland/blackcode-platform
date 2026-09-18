# Phase 6: Seed and production

**Goal:** the app is provably identical to the mockup on the mockup's own data,
and it is live at `billing.blackcode.ch`.

- **The problem** — everything up to here has been checked against itself. A
  suite that passes says the code does what the code says; it does not say the
  totals are the ones Andrea reviewed and approved in the mockup, and it says
  nothing at all about the screens, because every automated check in this repo
  sees `app/api/**` and nothing else. There is also a specific blindness this
  build has carried since phase 0: every test has run against one workspace with
  data in it, so nothing has ever exercised the state a new tenant is actually
  in, and a detail page reached with no parameters on an empty tenant is where
  three separate agents found a crash on the mockup side.
- **What this phase does** — builds a development seed from the mockup's own data
  file, plus a second, deliberately near-empty workspace; asserts parity to the
  rappen against it; writes the pitfalls guide topic; walks every screen in a
  browser on both tenants in both languages; and then releases in the one order
  that leaves every deployment telling the truth about the CLI version.
- **Expected result** — `npm run db:seed:billing` reproduces the mockup's
  numbers exactly; a per-page browser report exists naming what was seen on each
  screen; and `billing.blackcode.ch` serves the app with `bk billing` working
  from a clean `npm install -g` of the released binary.

## In one look

| | |
|---|---|
| **Data** | A development seed from the mockup's data file, and a second, near-empty tenant that exists to prove isolation and force the empty states. |
| **Logic** | Prove every total, every reference and every derived value matches the mockup to the rappen. |
| **UI** | Every screen walked in a browser, in both languages, on a full tenant and an empty one, reported per page. |

## Build

### The seed

**Its first cut lands in phase 1**, so the frontend has rows to bind to while
it builds the screens; this phase finishes it. See phase 1, "A first cut of
the seed".

`lib/db/seed.ts`, loading `fixtures/mockup.json` — a mechanical extraction of
`b-mockups/bbilling/assets/billing-data.js`, checked in, with a note recording
the mockup version it came from.

Two workspaces, and the second is not decoration:

| Workspace | Contents |
|---|---|
| `blackcode` | The mockup's data: 2 companies, 11 invoices including the voided one and the EUR-on-SCOR one, 4 recurrences including a completed series with a null template, 14 history rows, the audit trail. |
| `demo-tenant` | One company, **no invoices, no recurrences, no history.** Marked `demo: true`. |

The empty tenant is what makes the empty states real and what makes a
cross-tenant leak visible. **Isolation that is claimed and never demonstrated is
not isolation**, and the whole class of bug is invisible while only one workspace
has data. Do not invent a real client as the second tenant; it is named as a
demo so nobody mistakes seed data for a relationship.

`seed-guard.test.ts`, copied from books: **the seed refuses a non-local host
outright.** It rebuilds a workspace destructively, and there is no version of
that which should ever run against production.

Production is not seeded. A real company is created empty and billed into:

```bash
bk billing company create --slug blackcode --name "blackcode SA" \
  --legal-name "blackcode SA" --street "…" --iban … --number-format 'BC-{YYYY}-{SEQ4}'
```

### Parity

`lib/derive/parity.test.ts` walks the fixture and asserts, for every invoice:
the subtotal, the VAT amount, the total, the full reference including its check
digit, the formatted account, and the rendered number. **To the rappen and to
the character.**

This is the test that catches a rounding rule implemented differently from the
one Andrea reviewed, and it is the reason the fixture is checked in rather than
generated.

Two more, both from the books build's experience:

- **`runtime.test.ts`** — create a **third** company at runtime, invoice it, and
  assert the same invariants. Parity against a fixture proves the fixture; this
  proves the code. Nothing anywhere may assume two companies.
- **`invariants.test.ts`** — `dev-handoff/DATA-MODEL.md` §11's thirteen
  invariants as thirteen named tests, in the spec's own numbering. It is the
  index that keeps them audited, and a phase that adds an invariant adds a line
  here.

### The guide

`cli/internal/guide/topics/billing/`, seven topics:

| File | Contents |
|---|---|
| `00-billing.md` | what the app is and how to drive it (exists from phase 0) |
| `01-companies-and-numbering.md` | creating a company, the number format, why a number is permanent |
| `02-invoices.md` | creating, editing, the line editor, the VAT null-versus-zero distinction |
| `03-references-and-qr.md` | the combination matrix and the PDF, **without restating a single rate or status** |
| `04-sending-and-status.md` | the lifecycle, the void confirmation |
| `05-recurrence.md` | finite series, and that the app schedules nothing |
| `06-imported-history.md` | the archive and its flags |
| `07-pitfalls.md` | the mistakes specific to this app, below |

**`07-pitfalls.md` is the one worth writing carefully.** At minimum: a number is
permanent and a void is not a delete; `vat_rate: null` is not `0`; EUR can never
carry a QRR; `paid` is an assertion and reconciliation lives in b/books; the app
schedules nothing; per-currency sums are never merged; and `--company` is the
scope at which a wrong answer is a wrong IBAN.

**A topic must never restate a dynamic value.** `guide_test.go` fails the build
if one hardcodes a status, a vocabulary or a limit — and it only does so because
`vocabularySources` gained its `billing` line in phase 0. Watch that guard fail
once here, by restating three statuses in a topic, before trusting it.

If `bk billing --help` carries a prose tour of the command tree, it needs an
entry in `cli/internal/commands/help_prose_table_test.go` — finding #23 is a
hand-written tour that advertised a command the app did not carry and omitted the
two that wrote.

### The release

**The order is: deploy web, then npm, then deploy web again — and "web" means
every app, both times.**

1. `./devops/release.sh web <app>` for **every** line in `app_registry()`,
   including the new `billing` line.
2. `./devops/release.sh cli minor` — GitHub and npm. Needs `npm login` and an
   OTP. Answer `normal`, never `forced`.
3. `./devops/release.sh web <app>` for **every** app again.

The second pass is not belt-and-braces. The release script bumps
`CLI_LATEST_VERSION` in a commit it creates itself, so that commit lands *after*
the first deploy; without the second pass every deployment keeps advertising the
old version and no installed client is told an update exists. And because `bk`
asks whichever app the user is *homed* on, deploying only one app leaves
everyone homed on another uninformed.

**Do not raise `CLI_MIN_VERSION`.** Adding an app does not lock anybody out, and
raising the floor before the npm publish is verified locks out every user with
nothing to upgrade to.

Then, from a clean machine: `npm install -g @blackcode_sa/bc-issues`,
`bk login --server https://billing.blackcode.ch`, and walk the north-star
sequence — `bk billing workspace use`, `company create`, `invoice create`,
`invoice pdf`, `invoice send`. **Run it literally.** The sales build's north-star
script failed at its second command, because `bk workspace use` resolves through
a route nobody had checked was mounted.

## Done when

- [ ] `npm run db:seed:billing` reproduces the mockup's numbers **to the rappen**,
      and `parity.test.ts` asserts it rather than a human comparing screenshots
- [ ] A third company created at runtime satisfies every invariant
- [ ] All thirteen DATA-MODEL invariants exist as named tests
- [ ] The seed refuses a non-local host
- [ ] `demo-tenant` renders **every** page as a real empty state that says what
      the page is for — not a blank frame
- [ ] **Every detail page opened with no parameters at all, on the empty
      tenant.** This is the combination that turns `x() || ARRAY[0]` from
      invisible into an immediate `TypeError`, and it is the one three agents
      missed because they always arrived by a link carrying an id
- [ ] `grep -on "D\.[A-Z_]\{3,\}"`-equivalent for this codebase: every read of a
      collection goes through a workspace-scoped accessor. **`workspace_id` on a
      row scopes nothing; the read does** — in every leak found on the mockup
      side the rows were tagged correctly the whole time and the read was
      unscoped
- [ ] Every subject-carrying parameter refuses or states its substitution:
      `?company=` on every page, `{ref}` on the invoice, `{seq}` on the
      recurrence and the history row. **The rule is that any parameter which
      changes what the page is about is a subject** — a record id, a company
      slug, a period. `?lang=` is not one: it changes how the page reads, not
      what it is about.
- [ ] `npm run typecheck && npm test && npm run lint && npm run build`, and
      `cd cli && go build ./... && go vet ./... && go test ./... && make routes`
- [ ] The guide's dynamic-value guard was watched failing on a topic restating
      three statuses
- [ ] **A per-page browser report exists**, naming what was seen on each of:
      overview, invoice list, invoice detail (`?new=1`, no parameter, on both
      tenants), companies, settings, history, login, `/cli/authorize`,
      settings/tokens — in FR and EN, **on a string that differs between the two
      languages**
- [ ] The deploy log says "applying Drizzle migrations"
- [ ] `bk app list` shows `billing` with its `base_url`, from a clean global
      install of the released binary
- [ ] The north-star sequence run literally, end to end, against production

## Progress

**Backend built 2026-09-18** on `feat/billing-phase-6-be` (ticket #95), except
the release. Details and mutations: `apps/billing/docs/backend.md`, "Phase 6,
backend". What building it changed:

- The seed has **three** workspaces, not two: D-B7's inclusive-VAT company went
  to its own `praxis-demo`, so `blackcode` is exactly the mockup.
- The mockup's **recurrences** are not seeded (phase 4 is not built) and its
  **audit trail** is not seeded at all (phase 1's decision: no invented rows in an
  append-only log).
- The seed verifies parity itself, reading every invoice back through the app.
- `invariants.test.ts` found **I12 half-built**: the issuer is not snapshotted
  at send. Assigned to #86, and **closed there on 2026-09-18** (migration 0011);
  the "KNOWN GAP" case went red as written and is now the invariant.
- `?company=` naming nothing is refused on all three list routes.

Not done, and not doable from this repo alone: the release, the production
checks, `bk app list` from a clean install and the north-star sequence — all
need the `bc-billing` Vercel project. The browser walk is #96.

## Notes

**Never verify a translation on a string that is the same in both languages.**
The mockup build produced a false negative and a false positive on the same day
because a page title read identically in French and English. Pick a word that
must change.

**Stamp what a verification claim describes.** A commit hash, or "working tree at
18:05". Otherwise "billing: 0 findings" silently becomes a claim about a file
that no longer exists.

**Before reporting a negative, say what question your command actually asked.**
The four recorded failures of this on the platform build were all the same shape:
the check was correct and the claim made from it was larger than the check. "No
page has a signup screen" was really "no page's *path* contains signup", and it
was a tab on `/login`.

**The five open questions that gate a real invoice.** Phase 6 ships the mockup's
placeholders, each visibly flagged, and the app is usable. But the first **real**
bill cannot go out until: **P1** the real second company, **P2** blackcode's real
UID and IBANs, **P3** the ESTV-verified VAT rates, **P11** the QRR body scheme
agreed with the bank, and **P8** the VAT rounding rule confirmed by the
fiduciary. Say that plainly at handover rather than letting a green suite imply
otherwise.

**What this phase does not do.** It does not extract this folder into
`apps/billing/docs/` — that move happens when the app directory exists, which is
phase 0, and this folder's own header says so. It does not close
`docs/2026-08-multi-app-refactor.md` §9, whose open items this app inherits
rather than resolves. And it does not make b/clients, b/tax or b/books exist:
every borrowed field still sits behind its accessor and its chip, which is what
makes each of those a later data-source swap rather than a rewrite.

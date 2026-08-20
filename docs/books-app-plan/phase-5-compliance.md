# Phase 5: Compliance and retention

**Goal:** the adversarial check, the retention answer, and a deployable app.

> **Building in a week?** This whole phase is deferred. See
> [`week-one.md`](week-one.md). Two things here are cheap enough to keep anyway
> and are on week one's non negotiable list: no hard delete, and posted entries
> immutable with reversing entries as the only correction path.

## In one look

| | |
|---|---|
| **Data** | The rulebook of legal checks, the verdict each check gave on each entry, and whether a human approved, edited or rejected each rule. |
| **Logic** | Refuse to save an entry a check marked as blocked, refuse to delete anything because Swiss law requires ten year retention, and never invent a score or a judgement. |
| **UI** | Warning flags on entries that failed a check, and one new screen to approve or reject each legal rule. No other screen changes. |

## Module diagram

```
  humans ──▶ UI  ─┐
                  ├──▶ routes ──▶ queries ──▶ database
  agents ──▶ CLI ─┘                 │
                                    └─▶ posting refuses a blocked verdict
```

```
┌─ UI ────────────────────────────────────────────────────────
│  components/compliance   the rule review screen             new
│  components/**           verdict flags on records       altered
└─────────────────────────────────────────────────────────────

┌─ CLI ───────────────────────────────────────────────────────
│  commands/books/compliance.go    list, approve, reject      new
│  guide/topics/books/*.md         filled out             altered
└─────────────────────────────────────────────────────────────

┌─ BUSINESS LOGIC ────────────────────────────────────────────
│  app/api/workspaces/[ws]/compliance-rules                   new
│  lib/db/queries/compliance.ts    rules and verdicts         new
│  lib/db/queries/transactions.ts  posting checks verdict altered
│  lib/db/queries/footprint.ts     retained, cannot remove    new
└─────────────────────────────────────────────────────────────

┌─ DATA ──────────────────────────────────────────────────────
│  lib/db/schema.ts   compliance_rule, verdict fields    altered
│  migrations/0007    the rulebook and the verdicts
│  no purge path for any accounting table
└─────────────────────────────────────────────────────────────
```

**Platform packages: possibly altered, and this is the only phase where that is
true.**

| Package | Why it might change |
|---|---|
| `platform-api` | `AppContext.footprint` assumes an app can remove a person's data. b/books cannot, for ten years. The account close flow has never met an app that refuses, so the shared contract may need to express refusal. **Raise it before writing code.** |

**Shared files this phase alters:** possibly `packages/platform-api`, per above.
Nothing else.

## Build

### Migration 0007: tables and fields

| Item | Notes |
|---|---|
| `compliance_rule` | Loaded from `bbooks/compliance/rules.json` in the `b-mockups` repo. 19 rules today. |
| verdict fields on records | verdict, rules triggered, worst case, what would resolve it |

Every rule carries `source_confidence` (verified against Fedlex, inferred from
doctrine, or needs a fiduciary check) and `review_state` (draft, approved,
edited, rejected).

**All rules are DRAFT until the fiduciary signs off.** Render that state. The
review and approve screen is a first class feature, not an admin afterthought.

### Enforcement

The Devil's Advocate is an external agent pass. It writes verdicts onto records.
It never corrects anything.

The one thing the server enforces: a `blocked` verdict refuses to post. Check it
in the posting path, server side.

### Footprint

`AppContext.footprint` is required. It answers what this app holds for a person
and how to remove it, and the whole account close flow calls it.

b/books cannot delete anything for 10 years (art. 958f CO). So its answer is
"holds statutory records, retained, cannot be removed".

**Raise this before implementing.** The close flow has never met an app that
refuses. This is a platform conversation, not an app decision.

### Trash

The platform gives every app `trash list, restore, purge`. Accounting rows have
no purge path. Either do not mount the verb for those nouns, or make purge
refuse with a reason.

### Hardening

- Every invariant in `bbooks/dev-handoff/DATA-MODEL.md` section 17, in the `b-mockups` repo, as an automated test
- Guide topics for `bk books` filled out. The folder was created in phase 0
  because route attribution needs it. Here it gets real content.
- No help text or guide topic restates a dynamic value. Statuses, vocabularies
  and limits come from `bk meta --app-server books`, because they change without
  a CLI release
- Every books help string and guide topic that points at the vocabularies names
  that spelling, not the bare `bk meta` — which answers from whichever app the
  config is homed on. (There is no `bk books meta`; see phase 0's correction of
  2026-08-20.)
- Statutory PDF export renders in French

### Deploy

Steps 7 to 10 of `docs/adding-an-app.md`: deploy, DNS, cookie domain.

Their own documentation marks this **unknown, nobody has done it** for a second
production app. Budget real time and expect surprises.

## Done when

- [ ] A blocked verdict refuses to post, server side
- [ ] The rule review screen shows draft state honestly
- [ ] Footprint answers, and the close flow handles the refusal
- [ ] No purge path exists for accounting rows
- [ ] Every invariant has a test that goes red when broken
- [ ] The app is deployed and reachable

## Frontend gets

Compliance flags on records, and the rule review and approve screen.

## Notes

**Break your own guards and watch them fail.** Fourteen guardrails in the
platform repo have been found green but inert, and five of those were found by
the phase whose job was to disbelieve the previous ones. A guard you have not
watched fail is a guard you do not have.

**Ten year retention is not negotiable.** No hard delete. Soft delete everywhere.
Originals are immutable. Corrections are new linked versions.

**Flags are facts.** A date passed, a document is absent, arithmetic crossed a
threshold. Never an invented risk score, never a compliance judgment computed by
the app.

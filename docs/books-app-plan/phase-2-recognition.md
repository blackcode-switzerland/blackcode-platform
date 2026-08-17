# Phase 2: Recognition

**Goal:** turn bank noise into meaning, and ship the first write paths.

This is the product. Bilan and compte de résultat are arithmetic. Recognition is
the one place judgment lives.

> **Building in a week?** See [`week-one.md`](week-one.md). The matcher fits in
> about 20 lines and is worth building even in a compressed cut, because without
> it there is no product. Tolerance, intervals and the taught by provenance can
> come later.

## In one look

| | |
|---|---|
| **Data** | Rules such as "payments to this landlord on this account mean office rent", which entry taught each rule, and every entry's original unexplained state kept forever. |
| **Logic** | Compare each new bank line against every rule and explain it if one matches, put anything that matches nothing onto a to do list, and save a human's explanation as a new rule. |
| **UI** | One screen goes live, the to do list. The first buttons that change data appear here, and their save pattern is reused by every later screen. |

## Module diagram

```
  humans ──▶ UI  ─┐
                  ├──▶ routes ──▶ queries ──▶ database
  agents ──▶ CLI ─┘
```

```
┌─ UI ────────────────────────────────────────────────────────
│  components/recognition  the to do list screen              new
│  components/recognition  the resolve form, first write      new
│  lib/mutations.ts        the first real write hooks     altered
└─────────────────────────────────────────────────────────────

┌─ CLI ───────────────────────────────────────────────────────
│  commands/books/worklist.go                                 new
│  commands/books/rule.go          list, create               new
│  commands/books/resolve.go                                  new
│  client/books.go         the first write methods        altered
└─────────────────────────────────────────────────────────────

┌─ BUSINESS LOGIC ────────────────────────────────────────────
│  app/api/workspaces/[ws]/worklist                           new
│  app/api/workspaces/[ws]/rules            GET and POST      new
│  app/api/workspaces/[ws]/entries/[n]/resolve      POST      new
│  lib/derive/recognition.ts   matchesRule, worklistFor       new
│  lib/db/queries/rules.ts     rules CRUD                     new
│  lib/db/queries/resolve.ts   resolve, keep provenance       new
└─────────────────────────────────────────────────────────────

┌─ DATA ──────────────────────────────────────────────────────
│  lib/db/schema.ts        recognition_rule              altered
│  migrations/0004         the rules table
└─────────────────────────────────────────────────────────────
```

**Platform packages: imported, never altered.**

**Shared files this phase alters:** none.

**The layer that matters here is business logic.** The UI is one screen and the
data is one table. The value of the phase is `matchesRule` and the resolve write
path, and those are the two things to review hardest.

## Build

### Migration 0004: table

`recognition_rule`

| Field | Notes |
|---|---|
| `source_id` plus `counterparty` | The match key is the **pair**. Never the merchant name alone. |
| `pattern` | counterparty, amount, tolerance, interval |
| `explanation` | what a match means, for example "loyer bureau Prilly" |
| `account` | the target account of a match |
| `created_from` | the transaction that taught this rule |
| `source` | contract, subscription, or manual |

### Logic (`lib/derive/`)

- `matchesRule(tx, rule)`: source pair equality, counterparty substring on the
  raw label, amount within tolerance when set.
- `worklistFor(entity, exercice)`: everything unrecognized or inferred.

### Write paths (`lib/db/queries/`)

The first mutations in the app. Both run in one transaction.

1. `resolveTransaction`: sets the explanation, the account and the recognition
   state. **Keeps the old state in `history` forever.** Resolution answers the
   question, it does not erase where the answer came from.
2. `createRuleFromResolution`: writes the rule and records which transaction
   taught it.

### Routes and CLI

| Route | Command |
|---|---|
| `GET /api/workspaces/{ws}/worklist` | `bk books worklist` |
| `GET /api/workspaces/{ws}/rules` | `bk books rule list` |
| `POST /api/workspaces/{ws}/rules` | `bk books rule create` |
| `POST /api/workspaces/{ws}/entries/{n}/resolve` | `bk books resolve` |

## Done when

- [ ] The loop runs end to end: unrecognized, resolved, rule created, next match
      applies automatically
- [ ] The resolved row still shows "was: unrecognized"
- [ ] The same merchant on a source with no rule stays unrecognized. It is never
      silently matched.
- [ ] The frontend has a working gated mutation

## Frontend gets

**1 page live:** Reconnaissance.

Plus the write pattern that every later phase copies: `useCanWrite()` and
`useRecordMutation` in `lib/mutations.ts`, with no `fetch` in any component.

## Notes

**Why the pair matters.** The same merchant name can appear on a card you track
and a card you do not. Matching on the name alone would file money from an
untracked source as if it were understood. The pair keying is what keeps the
completeness signal honest.

**Provenance is permanent.** This is a standing rule across all b/ apps, not a
b/books preference. Never merge an inferred entry into a confirmed one.

**No risk scores.** A flag is a fact: a date passed, a document is absent, an
arithmetic result crossed a threshold. The app never computes a judgment.

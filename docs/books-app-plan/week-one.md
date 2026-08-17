# Week one: the usable cut

**Goal:** a real, correct bookkeeping tool in seven days. Entries balance, nothing
can be edited after posting, every entry carries its evidence tier and a link to
its proof, and the balance sheet and profit and loss come out in statutory order.

This is a **vertical slice across phases 0, 1 and 2**, not a seventh phase. The
phase docs beside this one stay the full specification. Every table built here
survives into that plan unchanged.

## In one look

| | |
|---|---|
| **Data** | Seven tables. Books, years, accounts, entries with their lines, rules, and a flat list of money sources. Documents are a pasted Drive link on the entry. |
| **Logic** | Balanced entries enforced by the database, balances derived from postings, bilan and compte de résultat in legal order, and a 20 line rule matcher. |
| **UI** | Four read only screens plus one write screen. The CLI does every other write. |

## The five decisions that make it fit

### 1. Build a vertical slice, not thirteen layouts

Phase 0 as written builds all 13 screen layouts against fixtures before a
database exists. That is right for a months long build with two devs working in
parallel. In one week it means spending the week on screens that show nothing.

Build schema, derivations, CLI, then four screens.

### 2. The CLI does the writes, the UI does the reads

Forms are slow to build. Commands are fast. So the CLI carries the whole write
path and the UI is read only, with exactly one exception.

- **CLI writes:** `bk books entry create`, `resolve`, `rule create`
- **UI reads:** overview, ledger, bilan, compte de résultat
- **The one write screen:** the worklist resolve action, because that is the loop
  a human wants a mouse for

This is not a shortcut away from the architecture. It is the architecture: agents
drive the app from outside, the human surface is read mostly.

### 3. Seven tables

| Keep | Why |
|---|---|
| `entity` | the user creates books and may have any number |
| `exercice` | **do not skip.** A year boundary is the one thing that is genuinely expensive to retrofit |
| `account` | the chart, with `statement_position` |
| `entry` | one row per écriture |
| `entry_line` | the debit and credit lines |
| `rule` | the legibility engine. The matcher is about 20 lines |
| `source` | flat lookup only, because rules key on (source, counterparty) |

| Cut for now | Replaced by |
|---|---|
| `piece_inbox`, `drive_manifest`, `source_pull`, `runbook` | `piece_url` and `piece_hash` columns on `entry`. Paste a Drive link. Roughly 90 percent of the evidence value for 2 percent of the work |
| `analysis`, `analytique_category` | three numbers on the overview: cash, monthly burn, runway |
| `compliance_rule` | nothing. It is an external agent pass anyway |
| `patrimoine` | nothing. Year end only, and there is no year end yet |
| `ri_entry` | see decision 4 |

Also cut from `source`: the three layer hierarchy, `draws_from`, expected cadence
and computed staleness. Those are good and they are not week one.

### 4. Run the sole proprietorship in voluntary double entry

This deletes a whole second ledger model, its derivations and its screens.

Below the CHF 500,000 threshold an RI **may** keep full double entry by choice,
and many do for credit and optimisation reasons. So elect it, and build one ledger
model instead of two.

**This is safe in the direction that matters.** The forbidden thing is letting an
SA fall back to simplified bookkeeping, and that stays impossible. The reverse is
a legitimate election. Record it as `regime_election: 'voluntary_double_entry'` on
the entity so the simplified path can be added later without a migration, and so
nobody mistakes it for a permanent design decision.

### 5. Six things that are not negotiable, even in a week

Each is about an afternoon, and they are what makes this bookkeeping rather than a
spreadsheet:

1. Balanced lines enforced by a database trigger, not by app code
2. Posted entries immutable. Corrections are reversing entries
3. No hard delete anywhere
4. `raw_label` never overwritten, so the original bank text survives
5. 959a and 959b order as code constants. `statement_position` as data
6. `evidence_tier` on every entry, and `tva_input_claimed` independent of it

Skip any one of these and you have built something that needs rewriting rather
than extending.

## The entry table, concretely

```
entry
  id, seq, entry_no                 seq addresses the row, entry_no is the
                                    gapless journal number per (entity, exercice)
  entity_id, exercice_id, date
  status                            'posted' | 'staged'
  source_id                         nullable
  raw_label                         never overwritten
  counterparty                      nullable
  explanation                       nullable
  recognition                       'known_recurring' | 'known_one_off'
                                    | 'inferred' | 'unrecognized'
  matched_rule_id                   nullable
  evidence_tier                     'full' | 'partial' | 'bare'
  evidence_note                     nullable
  tva_rate, tva_amount,
  tva_input_claimed, tva_note       input_claimed never derived from the tier
  piece_url, piece_hash,
  piece_captured                    nullable. A Drive link, never an upload
  reverses_entry_id                 nullable. The only correction path
  history                           nullable. Provenance, permanent
  created_at, updated_at, deleted_at

entry_line
  id, entry_id, account_no, debit, credit
```

**Store flat, serve nested.** The columns above are flat for speed of building,
but the API still returns the mockup's shape, because the frontend dev codes
against that:

```jsonc
{ "tva":   { "rate": 8.1, "amount": 406.2, "input_claimed": false, "note": {} },
  "piece": { "drive_ref": "drive://...", "hash": "sha256:...",
             "captured": "2026-01-05" } }
```

Keep the field name `drive_ref` in the API even though the column is `piece_url`.
When the real pipeline lands in phase 3 the frontend changes nothing.

## The week

| Day | Work |
|---|---|
| 1 | Scaffold, seven tables, the guards, seed from the mockup |
| 2 | Derivations, then bilan and compte de résultat matching the mockup to the rappen |
| 3 | CLI: entry create, list, show, bilan, cr. **Real books are keepable from here** |
| 4 | Rules, worklist, resolve, all via CLI |
| 5 | UI: overview, ledger, bilan, compte de résultat. Read only |
| 6 | UI: the worklist and the resolve action. The one write screen |
| 7 | Buffer, the paste a Drive link field, and the invariant tests |

## Done when

- [ ] Bilan balances on every entity, tested with a book created at runtime
- [ ] Numbers match the mockup at `localhost:8734/bbooks` to the rappen (see the top of the README for how to run it)
- [ ] Posting an unbalanced entry fails. Editing a posted entry fails. Deleting a
      row with history fails
- [ ] An unrecognized entry can be resolved, a rule created from it, and the next
      matching entry recognises itself
- [ ] Every entry shows its evidence tier, and a `partial` or `bare` entry never
      claims input VAT

## What you do not get, said plainly

No bank import, so entries arrive by CLI or by hand. No OCR and no receipt worker,
so evidence is a pasted link. No multi year and no year end close. No management
dashboard beyond three numbers. No compliance pass. No French.

## How this grows into the full plan

| Week one has | Grows into |
|---|---|
| Seven tables | [phase 1](phase-1-statutory-core.md) adds `opening_balance` and the mapping audit trail |
| A 20 line matcher | [phase 2](phase-2-recognition.md) adds tolerance, intervals and the taught by provenance |
| `piece_url` on the entry | [phase 3](phase-3-sources-pieces.md) adds the inbox, the worker, the manifest and the locked archive |
| Three numbers | [phase 4](phase-4-management.md) adds the charts and the agent write back |
| Nothing | [phase 5](phase-5-compliance.md) adds the rulebook and the retention answer |
| Four screens | The remaining nine, in the phase that owns each |
| One ledger model | The simplified path, if the RI ever drops the election |

Nothing here is thrown away. The compression is in what is left out, not in what
is built wrong.

## Do this first

Read `bbooks/assets/bbooks-data.js`, in the `b-mockups` repo, end to end before writing migration 0001. Two hours.

`DATA-MODEL.md` is the document the schema would otherwise be written from, and it
was extracted at mockup v17 while the mockup is at v19, with at least one
confirmed gap. Compressing six phases into one week makes a schema error more
expensive, not less, because there is no slack to absorb it.

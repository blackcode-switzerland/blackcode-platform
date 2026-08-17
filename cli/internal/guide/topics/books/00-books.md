# b/books — what it is and how to drive it

b/books keeps **statutory bookkeeping** for any number of books. A *book* is one
legal entity's set of accounts: a company, or a person's self-employment
activity. A user creates as many as they need and nothing in the app assumes a
particular number.

The point of it is not that transactions are recorded. It is that every one of
them is **explained**: what the money was, why it moved, through which channel,
and where the proof is. Unexplained money is a worklist, never a buried column.

## This app holds no intelligence, and that is the design

b/books stores legible records and derives statements. It does not decide what a
transaction means. **You do** — or the agent you are running does — and the app
remembers the decision so the next matching transaction is handled
automatically.

So there is no chat here, no in-app assistant, and no scenario buttons. You read
the data through these commands, reason outside, and write the conclusion back.

## Status: phase 0

The app skeleton, its Postgres schema and this command group exist. The
bookkeeping nouns do not yet. What lands when:

| Phase | Commands |
|---|---|
| 1 | `entry`, `account`, `exercice`, `bilan`, `cr` — the statutory core |
| 2 | `rule`, `worklist`, `resolve` — recognition |
| 3 | `source`, `piece` — where money came from, and the proof |
| 4 | `analyse`, `tax` — the management view and agent write-back |

`bk books note` is the scaffold's placeholder entity. It exists so this app has a
route and a command that can be parity-checked while phase 0 is in progress, and
it is removed in phase 1. Do not build anything on it.

## Tenancy

```bash
bk books workspace list
bk books workspace use <slug>     # sets THIS app's active workspace only
bk books member list
bk books invite send <email>
```

Membership is the whole access gate. `bk books workspace use` does not disturb
the workspace `bk sales` or `bk issues` is pointed at; the choice is stored per
app.

## What this app deliberately does not have

**No uploads.** Supporting documents live in Google Drive and b/books stores the
reference plus a hash, never the file. There is no `bk books upload`.

**No trash and no purge.** Accounting records carry a ten-year retention duty
(art. 958f CO). Nothing here can be hard-deleted, so there is no bin to empty.

**No editing a posted entry.** A correction is a reversing entry. That will be
enforced by the database, not by this binary.

## Output and exit codes

`--json` and `--yaml` work here exactly as everywhere else. Amounts and dates are
printed as they arrive, as strings: an amount is `numeric(14,2)` and rounding one
through a float in an accounting tool is a bug, not a formatting choice.

See `bk guide platform/output-and-exit-codes`.

## Vocabularies

Recognition states, evidence tiers, VAT rates and every limit are served live by
`bk meta`. They change without a release of this binary, so this topic does not
list them.

# b/books — what it is and how to drive it

b/books keeps **statutory bookkeeping** for any number of books. A *book* is one
legal entity's set of accounts: a company, or a person's self-employment
activity. A user creates as many as they need and nothing in the app assumes a
particular number.

The point of it is not that transactions are recorded. It is that every one of
them is **explained**: what the money was, why it moved, through which channel,
and where the proof is. Unexplained money is a worklist, never a buried column.

Related commands: `bk books overview`, `bk books entity list`, `bk books
workspace list`, `bk books workspace use`, `bk books member list`, `bk books
invite send`.

## This app holds no intelligence, and that is the design

b/books stores legible records and derives statements. It does not decide what a
transaction means. **You do** — or the agent you are running does — and the app
remembers the decision so the next matching transaction is handled
automatically.

So there is no chat here, no in-app assistant, and no scenario buttons. You read
the data through these commands, reason outside, and write the conclusion back.

**Writing it back is not optional and is not a thing to ask permission for.**
When somebody asks you an analytical question about a book — runway, whether a
hire is affordable, why a month looks wrong — you answer it AND file it with
`bk books analyse record`, in one action. An answer that stays in a chat
transcript is an answer the book does not have.
→ `bk guide books/statements`

## The web surface is read-only

Every screen in the browser reads. **Nothing in it writes.** Posting an entry,
resolving a bank line, importing a statement, filing an analysis — all of it
happens here, through this CLI. An agent driving `bk books` is not doing a
reduced version of what a person does in the app; it is doing the only version.

## Where to go next

    bk guide books/starting-a-book   create it, configure it, open its balances
    bk guide books/money-in          feeds, imports, the worklist, rules
    bk guide books/entries           writing entries by hand, VAT, posting
    bk guide books/documents         pièces justificatives and the robot door
    bk guide books/statements        bilan, résultat, tax, analyses
    bk guide books/year-end          closing a year and carrying it forward
    bk guide books/pitfalls          the mistakes specific to this app

## Tenancy

```bash
bk books workspace list
bk books workspace use <slug>     # sets THIS app's active workspace only
bk books member list
bk books invite send <email>
```

Membership is the whole access gate, and the active workspace is stored per app:
choosing one here disturbs no other app's choice.

**One workspace per person, for now.** Signing in mints it; `bk books workspace
create` refuses a second and names the one you have. This is a deliberate
restriction rather than a limit of the model — sharing a workspace needs the
invitation flow, which is not open yet. So if you are running several
companies, they are several BOOKS in the one workspace, not several
workspaces: `bk books entity create` is the command, and every read takes
`--entity <slug>` to pick between them.

Most read commands take `--entity <slug>` and `--exercice <year>` and fall back
to the first book and its latest year. **Pass them explicitly in a script.** A
workspace with three books will answer about whichever one sorts first, and the
answer will look perfectly reasonable.

## What this app deliberately does not have

**No uploads.** Supporting documents live in Drive and b/books stores the
reference plus a hash, never the file. There is no `bk books upload`.

**No trash and no purge.** Accounting records carry a ten-year retention duty
(art. 958f CO). Nothing here can be hard-deleted, so there is no bin to empty,
and no workspace, book, account or rule is ever removed.

**No editing a posted entry.** A correction is a reversing entry, and the
database enforces it with a trigger rather than app code. Interpretation stays
open: `bk books resolve` works on posted entries for explanation and
recognition, and refuses only the account.

**No reopening a closed year.** Same doctrine, one level up.

## Output and exit codes

`--json` and `--yaml` work here exactly as everywhere else. Amounts and dates are
printed as they arrive, as strings: an amount is a fixed-point decimal and
rounding one through a float in an accounting tool is a bug, not a formatting
choice.

See `bk guide platform/output-and-exit-codes`.

## Vocabularies

Recognition states, evidence tiers, VAT rates and every limit are served live by
`bk meta --app-server books`. They change without a release of this binary, so
this topic does not list them.

The `--app-server books` half is not decoration. `bk meta` answers from whichever
app your config is homed on, and one deployment cannot answer for another — ask
the wrong one and you get a correct answer to a different question. `--app-server
books` asks this app for one invocation and changes nothing about your config;
if books is already your home app, plain `bk meta` is the same call.

There is no `bk books meta`, and that is a decision rather than a gap. `meta` is
the command that WRITES the app registry, while every `bk books …` command
RESOLVES its server through that registry — so an app-owned spelling could not
run in the state it is most needed in: a config that has no address for books
yet.

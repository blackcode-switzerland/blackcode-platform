# The pipeline: prospects, stages and the deal journey

A prospect is a company AND its deal in one record — you do not create an
"account" and then an "opportunity" against it. Everything else in this app hangs
off a prospect by its #number.

Related commands: `bk sales prospect list`, `bk sales prospect show`,
`bk sales prospect create`, `bk sales prospect edit`, `bk sales prospect stage`,
`bk sales prospect delete`.

## Which workspace am I in?

Most people in b/sales have one workspace — their own, created at sign-in — and
never need to think about this. You get a SECOND one by being invited into
somebody else's, and then every command needs to know which you mean.

```bash
bk sales workspace list           # both, with the active one marked *
bk sales workspace use <slug>     # switch; remembered on the server
bk --ws <slug> sales prospect list  # one command elsewhere, without switching
```

Two things worth knowing. **The active workspace belongs to this app alone** —
switching here moves nothing in any other app, because each app's workspaces are
unrelated and their ids overlap (`bk guide platform/apps`). And **it is shared
with the web UI**: `workspace use` and the sidebar switcher write the same
place, so `/dashboard` opens where you last were, whichever one you used.

`bk login` seeds it, so a fresh login can run a command straight away.

## The one thing to do first

Run `bk meta`. Every vocabulary in this app — pipeline stages, next-action types,
communication channels, meeting types — is served live from the server, and so
is every limit. They change without a release of this binary, so nothing in this
guide lists them. If a command rejects a value, `bk meta` is where the accepted
ones are.

`bk meta --vocab <key>` prints ONE of them as a flat list, one value per line
(and a plain array under `--json`, so it pipes). `bk meta --vocab` with no key
lists the keys, and an unknown key is an error naming the ones that exist:

```bash
bk meta --vocab                   # which vocabularies this server serves
bk meta --vocab stages            # the values, with their labels
```

The `--help` of a flag that takes one of these values also names the values, as
a fast path. **`bk meta` is the authority** — the help text was written when the
binary was built, this reads the server. Where they disagree, the server wins.

## Which prospect? Either spelling works

Every command that acts on a prospect takes its #number as the first argument
**or** as `--prospect <n>`:

```bash
bk sales contact add 12 --name "Julien Roche"
bk sales contact add --prospect 12 --name "Julien Roche"     # the same call
bk sales comm log 12 --channel <channel> --dir out           # also the same
```

Naming two DIFFERENT prospects — `bk sales objection counter 12 3 --prospect 9` —
is an error that names both, and nothing is changed. The canonical spelling is
whichever one `--help` shows; the other exists so a wrong guess resolves.

## Finding a prospect

```bash
bk sales prospect list                      # everything, most recently touched first
bk sales prospect list --q roches           # substring match on the COMPANY NAME
bk sales prospect list --owner me           # what you are on the hook for
bk sales prospect list --stage <stage>      # one stage; repeat or comma-separate for more
bk sales prospect list --label <name>       # by label
bk sales prospect list --strategy <n>       # only the prospects linked to that segment strategy
```

`--q` matches the company name only — it is a substring filter on a listing, not
a search. Finding a phrase *inside* a record is a different command, and so is
finding something by name across every app.

The listing prints a cursor line on stderr when there are more rows. Pass it
back as `--cursor <n>`; stdout stays parseable either way.

## Reading one

```bash
bk sales prospect show 12
```

You get the record, the **deal journey** — one row per stage, including the ones
not reached yet — and every **cross-app link** touching this prospect, each with
an absolute URL you can follow into whichever app owns the far end. Links are
written into the record's own text as a URN; `bk guide platform/cross-app` has
the shape.

## Creating and editing

```bash
bk sales prospect create --name "Roches SA" --city Morges --value 15000
bk sales prospect edit 12 --summary "waiting on their board, mid-September"
```

`--value` is a plain amount. Never send a formatted one (`CHF 15'000`) — the
currency is its own flag, and formatting is something the reader does, not
something the record stores. The same applies to dates: resolve "next Thursday"
to a real date before you send it.

**An empty value clears a field.** `--city ""` removes the city; `--owner ""`
unassigns the deal; omitting the flag leaves it alone. Those three are distinct
on the wire, so "did nothing" and "cleared it" can never be confused.

## Moving a deal

```bash
bk sales prospect stage 12 <stage> --note "they asked for a revised quote"
```

This is deliberately not a field edit, and `bk sales prospect edit` refuses
`--stage` for the reason: moving a deal writes a step in the journey, attributed
to whoever ran the command, and a closing stage also records the close date and
reason. An edit that quietly set the column would leave a prospect whose own
history disagrees with it.

Re-posting the stage a deal is already in is refused rather than ignored — it
would otherwise append a second journey step for a move that never happened.

## Who wrote what

Every journey step carries an actor, and an agent's steps say so: the label comes
from the API token's name, so history written by an agent stays visibly
agent-written. That is why `bk token create --name <something meaningful>`
matters more here than it does elsewhere.

The deal **owner** is different and is always a real person. An agent can log a
call and write history; it cannot own a deal.

## Deleting

```bash
bk sales prospect delete 12 --confirm "Roches SA"
```

`--confirm` takes the **company name**, not the number you already typed, and it
is required even with `--yes` and even under `BK_NO_PROMPT=1`. Repeating the
number back proves nothing about whether it is the right one; the name is what
catches a wrong #number. If it does not match, nothing is deleted and the error
names the company that *is* at that number.

The delete is reversible — it moves the prospect and everything logged against it
to the recycle bin — and it prints what it binned, by type, #number and name.

## Addressing: the #number and the URN

Everything in this app is reached by its **#number** — `bk sales prospect show
12` means prospect #12 of that workspace. Row ids are never served and never
accepted.

The same number is the tail of the record's cross-app address:

```
bc:sales:<workspace>/prospect/<n>
bc:sales:<workspace>/template/<n>
```

That is what makes a record findable from another app and linkable to one
(a URN you can paste into another app's record). Run `bk meta` for the full list of addressable
types — it grows as this app does, which is exactly why this page does not
enumerate it.

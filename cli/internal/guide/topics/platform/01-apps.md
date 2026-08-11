# Apps — which app is this command talking to?

One binary, one login, one token — and more than one app. This topic is the rule
that keeps that from being confusing: **every `bk` verb belongs to one of two
tiers, and the spelling tells you which.**

Read it before your first write. Getting a tier wrong is not a syntax error — it
is a file, a label or a deleted item landing in the wrong app, where nothing
downstream can tell it was a mistake.

## The two tiers

**1. Bare — your ACCOUNT and this BINARY.**

```bash
bk login      bk logout     bk whoami     bk token      bk profile
bk meta       bk app        bk guide      bk skill      bk changelog
bk version    bk super-admin
```

One account, one password, one token, valid against every app. These read what
the platform genuinely shares — your user record, your tokens, the app address
book — or they read nothing at all and answer out of this binary. No app can be
the wrong one to ask.

**2. App-owned — `bk <app> <verb>`, because the answer depends on the app.**

```bash
bk issues issue create --title "…"    # that app's nouns
bk issues workspace list              # …and its tenancy
bk sales member list                  # the same verb, a different app, a
                                      # different set of people
bk issues upload contract.pdf
bk sales trash list
```

**Everything that touches an app's data is here.** Each app has its own
workspaces, members, invitations, labels, uploads, history and recycle bin.

## The test, and the one question behind it

> **Would two deployments give the same answer?**

If yes, the verb is bare. If no, the app is in the command.

That test has not changed. What changed is the facts it is applied to. Until
2026-08-10 the apps shared a database, so a bare `workspace list` had one
table to read and a bare `search` had one index. They do not share one now,
so those same verbs would have had no correct answer — only a **default**, taken
from whichever app you were last homed on, with nothing in the command saying
which.

That is the failure being removed. A bare `trash purge` used to destroy things in an
app the command never named. You could not read your own command back and know
what it hit.

## Why a namespace and not a `--app` flag

A flag can be forgotten, and a forgotten flag falls back to a default. A
namespace cannot be forgotten: there is no bare form to type. `bk issues upload`
reads exactly like `bk issues issue create`, so learning one teaches the other.

That is also why the old bare spellings were removed outright rather than kept as
aliases. An alias would have to pick an app silently, which is the accident being
removed. Instead:

```
error: unknown command "workspace" for "bk"
hint: the bare spelling is now `bk <app> workspace …` — each app has its own
      workspaces, and each remembers its own active one. Try
      `bk issues workspace list` or `bk sales workspace list`.
```

Non-zero exit, one line on stderr, the replacement named — recoverable inside the
same run.

## Each app remembers its own active workspace

```bash
bk issues workspace use acme     # sets THIS app's active workspace
bk sales workspace use acme      # …and this one's, separately
```

The two are different rows in different tables that may happen to share an id and
a slug. Setting one does not move the other, and a slug only means something
against the app it was resolved in. `bk meta` prints what each is.

If you upgraded from an older `bk`, the single active workspace you had comes
forward as your **home app's**, and no other app's — a slug resolved against one
app is not a workspace in another. Run `bk <app> workspace use <slug>` once per
app you work in.

## Not every app serves every verb

An app mounts the part of the shared surface it actually has, and the rest is
simply absent from its group rather than present and failing:

```bash
bk sales --help          # what THIS app offers
bk issues workspace --help
```

`apps/sales` has no create-workspace command, for example — a workspace is the
company, and you are granted one rather than opening one from a sales context.
A verb missing from `bk <app> --help` is a decision, not an outage.

## Which apps exist, and which you can reach

```bash
bk --help          # the app groups this BINARY has
bk meta            # the apps this TOKEN can reach, live, plus a `routing` block
bk <app> --help    # one app's commands
bk app list        # every app here: its server, and whether it answers
```

`bk --help` and `bk meta` answer different questions, and the difference matters:
a binary can know an app you have no access to, and a deployment can offer one
your binary is too old to have. When they disagree, `bk meta` is the live truth
and `bk skill sync` is how the binary catches up.

## Where a command actually goes

Each app is its own deployment, so "which app" is also "which server". The CLI
keeps an **address book** — learned from the platform, never typed — and routes
by tier:

| Tier | Server |
|---|---|
| Bare | the **home app**'s (it answers about your account, so any app answers alike) |
| App-owned | **that app's**, always — `bk <app> …` pins it |

```bash
bk meta               # refreshes the address book; prints where each tier goes
bk app list           # every app, its server, and whether it answers for you
bk app use sales      # move the home app: the bare verbs now go to sales
```

`bk app use` matters much less than it used to, and that is the point. It used to
decide where a dozen data commands landed. Now it decides only which deployment
answers questions about your account.

`bk <app> …` ignores it entirely. Its app is written on the command, so no mode,
default or previous command can move it — the property that makes a namespace
safer than a flag.

**Upgrading from bk 2.x? Run `bk meta` once.** A 2.x config has no address book,
and `bk` will not invent one.

### `--app-server` — the escape hatch, and when to reach for it

Almost never. `bk app use <slug>` is the right answer whenever you will run more
than one command.

`--app-server <slug>` redirects a SINGLE invocation and changes nothing on disk.
Use it for a one-off look at another app's deployment, or in a script that must
not disturb the config it found.

```bash
bk --app-server sales meta      # one look at sales, home app unchanged
```

It cannot move an app-owned verb: `bk --app-server sales issues upload x.pdf`
still uploads to issues. The name on the command wins over the flag, always.

**The flag is `--app-server`, not `--app`.** `--app` still means "filter by app"
on `bk changelog` and `bk guide`. One name, two meanings, would be a coin flip.

## When routing fails, it says so

The CLI never guesses an address. An app it has no server for is an error naming
the app, never a request sent to a different one — a wrong-host answer looks
exactly like a missing record, and you would have no way to tell:

```
error: no server known for app "sales" (registry has: issues)
hint: run `bk meta` to learn each app's server from the platform, `bk app list`
      to see what your config has now, or `bk login --server <url>`
```

An address that is known but dead says that instead, naming the app and the URL,
so a stale address book and a down deployment are distinguishable.

## Working across two apps

Nothing forces you to pick one, and the connector is **you, driving this binary**
— not a shared table. Work in the app that owns the thing, and carry the address
across by hand:

```bash
bk sales prospect show 8            # prints its URN
bk issues issue create --title "Export fails for Helvetia" \
  --description "Prospect: bc:sales:acme/prospect/8"
```

A URN — `bc:<app>:<workspace>/<type>/<number>` — is an address any app can print
and a human or agent can resolve. There is no command that records a relation
between two apps' records; the `link` verb was removed on 2026-08-10 for that reason,
because it needed one index that every app wrote into.

## The verbs are not spelled the same everywhere

Two apps grew separately, and so did their vocabulary. `bk issues issue view` and
`bk sales prospect show` are the same operation; so are `create` and `add`, and
`delete` and `rm`. Each app also disagrees with itself in places.

**You do not have to remember which is which.** Every verb accepts the other
spellings of its own operation, so a guess resolves rather than dead-ending:

| Operation | Spellings that all work |
|---|---|
| read one | `view`, `show`, `get` |
| list many | `list`, `ls` |
| make one | `create`, `add`, `new` |
| change one | `edit`, `update` |
| destroy one | `delete`, `rm`, `remove` |

`--help` shows one canonical spelling per command — that is the one to write down
and the one the docs use. The others are there so a wrong guess costs nothing.

Two things this does **not** do. It never crosses the app tier — dropping the app
name is still an error whichever verb you pair it with, because the app is not a
spelling preference. And it never overrides a real command: where a group already
has both `rm` and `show`, each keeps its own meaning.

The rule of thumb, if you remember nothing else: **if the answer would differ
between two deployments, the app is in the command.**

Related commands: `bk --help`, `bk meta`, `bk app list`, `bk app use`, `bk issues workspace list`, `bk sales member list`, `bk issues upload`, `bk issues trash list`

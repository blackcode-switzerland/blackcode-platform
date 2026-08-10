# Pitfalls: the five things that go wrong here

Read this once before scripting against this app. Every entry is a mistake that
is easy to make and hard to see afterwards.

Related commands: `bk sales prospect delete`, `bk sales objection rm`, `bk sales
search`, `bk meta`, `bk sales trash list`, `bk sales trash restore`.

## 1. Search this app with `bk sales search`

This is the one to learn first.

```
bk sales search  reads this app's full text.
                 "Find X INSIDE prospect summaries, meeting outcomes,
                 communication bodies, template copy."
                 Returns records, with the matching text.
```

It is the only search this deployment serves. The bare, cross-app `bk search`
reads a shared title index that this app no longer writes to, and asking this
deployment for it fails with exit 5 and a hint naming what to do instead —
loudly, rather than by returning an empty page that reads like "no matches".

That is the direction to be careful about: a phrase from a call summary was
never in the shared index, so reaching for the wrong command used to give you
nothing and no error. Now the wrong command says so.

## 2. Deleting requires the NAME, not the number

```bash
bk sales prospect delete 12 --confirm "Fiduciaire Roches SA"
```

`--confirm` takes the company name, and it is required **even with `--yes` and
even under `BK_NO_PROMPT=1`**. A prompt that auto-approves for an agent is not a
guard, so the guard is having to repeat the target back.

It is the name and not the number on purpose: repeating a number you already
typed proves nothing about whether it is the right record. The name proves you
looked. If it does not match, nothing is deleted and the error names the company
that *is* at that number — which is the recovery.

The same shape applies to `meeting rm` (the title), `comm rm` (the prospect's
name), `product`/`template`/`doc` (the name or title), and `objection rm` (the
type). And it is enforced by the server, not only by this binary.

## 3. One delete is permanent, and it is not the obvious one

Almost everything goes to a recycle bin:

```bash
bk sales trash list
bk sales trash restore prospect:12
```

Binning a prospect bins its contacts, meetings and communications with it, and
restoring brings back exactly those — not a meeting you binned separately last
week.

**`bk sales objection rm` is different: it destroys the row.** Objections carry
no bin state, because an objection is a note about a conversation rather than an
addressable record, so there is nothing to restore it from. If it stopped
mattering, `bk sales objection resolve` keeps the record, which is nearly always
what you want.

## 4. Send values, not renderings

Two shapes the server refuses, and both are easy to send by accident:

- **Money.** `--value 24000`, never `--value "CHF 24'000"`. The currency is its
  own flag. Formatting is something a reader does, not something a record stores.
- **Dates.** `--due 2026-08-11`, never `--due "next Thursday"`. Resolve the
  phrase yourself. Where the phrase matters, `--due-label "next Thursday"` keeps
  your words verbatim beside the date — displayed in preference to it, and never
  parsed back.

The same applies to timestamps: `--at` takes a real instant, so write up
yesterday's call with yesterday's time rather than letting it default to now.

## 5. Clearing a field is not the same as omitting it

```bash
bk sales prospect edit 12 --city ""      # removes the city
bk sales prospect edit 12 --owner ""     # unassigns the deal
bk sales prospect edit 12                # changes nothing, and says so
```

Absent, a value, and an explicit empty are three different things on the wire. If
you build a command line from variables, an unset variable that becomes `""` will
CLEAR a field rather than leave it alone.

## And two smaller ones

**Never hardcode a stage, channel or limit.** They are served live by `bk meta`
and change without a release of this binary. Every command that rejects one says
so and points there; nothing in this guide lists them, for the same reason.

**Moving a deal is its own command.** `bk sales prospect edit --stage` is refused
with a 400 naming the right one. Moving a deal writes a journey step and, on a
closing stage, the close date; an edit that set only the column would leave a
prospect whose own history disagrees with it, and nothing would say so.

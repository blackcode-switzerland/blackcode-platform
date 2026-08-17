# The daily loop: logging what happened

Everything in this app is a record of something that took place. Nothing here
sends a message, books a meeting, or notifies anybody — you do the work, and
these commands write down that you did.

Related commands: `bk sales comm log`, `bk sales comm list`, `bk sales meeting
schedule`, `bk sales meeting log`, `bk sales meeting outcome`, `bk sales meeting
cancel`, `bk sales objection raise`, `bk sales objection counter`, `bk sales
objection resolve`, `bk sales contact add`.

## Log a message

```bash
bk sales comm log --prospect 12 --channel <channel> --dir out \
  --subject "Revised quote" --body "Two milestones, 12k + 12k."
```

`--dir out` is us to them, `in` is them to us. Run `bk meta --vocab channels`
for the channels; the flag's own `--help` names them too, as a fast path.

The prospect can also be the first argument — `bk sales comm log 12 --channel
<channel> --dir out` — which is the shape `bk sales contact add` and the
objection verbs use. Both work on every command in this app.

**An internal note is a communication too.** This app has no comment threads, so
a thought about a prospect that was not said to anybody goes in the log with the
note channel and no direction ambiguity — it is still something that happened on
a date, by somebody.

`--at` defaults to now. If you are writing up yesterday's call, pass the real
instant: the log is ordered by when things happened, not by when they were typed.

## Meetings: two commands, one ledger

```bash
bk sales meeting schedule --prospect 12 --at 2026-08-11T10:00:00Z \
  --type <type> --title "Phase 2 review" --agenda "walk the offer"

bk sales meeting log --prospect 12 --at 2026-08-04T14:00:00Z \
  --type <type> --title "Discovery" --outcome "They need it before Q4."
```

Same ledger, same route — the difference is which moment you are describing. One
is going to happen, the other did.

This is **not a calendar**. Nothing is booked and nobody is invited; the meeting
exists here because it is part of the deal's history.

When a scheduled meeting happens:

```bash
bk sales meeting outcome 4 --outcome "Julien is sold; Salomé wants a reference."
```

Recording an outcome also marks the meeting as having happened, because an
outcome is evidence that it did. If it did not happen, `bk sales meeting cancel`
keeps that fact — which is worth keeping. Removing the record entirely is
`bk sales meeting rm`, and it wants the title repeated back.

## Objections: what they said, what they mean, what you say back

```bash
bk sales objection raise 12 --type <type> --raised-by "Julien" \
  --spoken "It is a lot for one quarter." \
  --real-fear "He cannot defend the spend to his board."
```

Keep those two apart. The gap between what somebody says and what is actually
worrying them is the whole reason this table has three columns instead of a
notes field.

```bash
bk sales objection counter 12 41 --counter "Split across two milestones."
bk sales objection resolve 12 41
```

Countered is not resolved: countered means you answered, resolved means it
stopped being in the way. Keeping them apart is what lets you see later which
counters actually worked.

`bk sales objection rm` **destroys the record permanently** — objections are the
one thing in this app with no recycle bin behind them. If it stopped mattering,
resolve it instead.

## What you know about them, as a log

```bash
bk sales prospect note add 12 --kind "site audit" --text "Wix site. 4 console errors on load, no SSL on booking."
bk sales prospect note list 12
```

**This is append-only, and it is the difference between it and `--summary`.**
`bk sales prospect edit --summary` OVERWRITES: "where this deal stands" has one
answer at a time, and replacing it is correct. A research log is the other
shape — a sequence of observations, each true when it was written — and before
this existed, recording a second finding meant destroying the first.

So: no `note edit`. If a finding turns out to be wrong, append the correction;
the log is what tells you what was known and when, and an editable one stops
being able to answer that. `--kind` is a free-text bucket, not a vocabulary.

`bk sales prospect note rm` **destroys the entry permanently** — the log has no
recycle bin — and requires `--confirm <note-id>`. It prints the whole note it
destroyed, which is the real protection: a wrong `rm` is visible in the next
line rather than in a month. Reach for it when a note landed on the wrong
prospect, not when a note turned out to be wrong.

Notes are searchable with `bk sales search`, which is often how you get back to
one: a half-remembered name from a site audit is exactly what the log holds and
nothing else does.

## The people

```bash
bk sales contact add 12 --name "Julien Roches" --role "Co-founder" --primary \
  --email j@acme.ch --phone "+41 79 000 00 00" \
  --linkedin https://www.linkedin.com/in/julien-roches \
  --decision-power champion --notes "Wants it. Cannot sign for it."
bk sales contact list 12
```

**The person fields are on the CONTACT, not on the prospect.** A prospect is the
company and the deal in one row; a phone number, an email, a LinkedIn profile
and a role belong to a human being, and that is a contact. Two issues were filed
saying the app could not hold any of it, because the prospect is where you look
and the contacts were one command away. `bk sales prospect show <n>` prints them
now, so the record is not silent about the people at it.

`--decision-power` records what somebody can **do** in the deal rather than
where they sit on an org chart — run `bk meta` for the current values. It is
worth filling in even when it feels obvious: the person who wants the thing and
the person who can sign for it are usually different people, and a rep who has
not written down which is which spends three meetings with somebody delighted
and powerless. `--notes` stays the freeform half — background, negotiation
history, how they behave in a room.

The company's own details — its site and its postal address — are on the
prospect, because a company has one of each and its people share them:

```bash
bk sales prospect edit 12 --website https://acme.ch --address "Rue du Rhône 42, 1204 Genève"
```

Contacts are listed with an **ID**, and that id is what `edit` and `rm` take. A
contact has no #number because it is never addressed on its own — it is always
reached through its prospect. Prospects, meetings and communications DO have
#numbers; contacts, journey steps, objections and matches do not, and the two
listings show you which you are looking at.

## Who gets the credit

Every logged row records who wrote it, and the name comes from your API token.
An agent's entries say so, which is the point: a history where you cannot tell
what a person did from what a tool did is a history you cannot audit. Name your
token for what it is.

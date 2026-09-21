# Recurring series

A series bills the same thing on a schedule, a **fixed** number of times, and
then stops. This page is how to set one up, how to run it, and why running it
twice is safe.

Related commands: `bk billing recurrence create`, `bk billing recurrence list`,
`bk billing recurrence show`, `bk billing recurrence generate`,
`bk billing recurrence edit`, `bk billing recurrence pause`,
`bk billing recurrence resume`.

## Every series ends

`recurrence create` requires the number of occurrences, and there is no default.
"Bill Junod quarterly, eight times" is something a client agreed to; "bill Junod
quarterly" is an instruction nobody revisits. When the count is reached the
series completes itself — nobody marks it complete, and a completed series is
final. A new agreement is a new series.

## Nothing happens on its own

The app stores the rule and **schedules nothing**. No invoice appears on its due
date. You, or an agent on a schedule of its own, ask what is due and generate it:

```
bk billing recurrence list --due
bk billing recurrence generate <#> --period <the period it shows>
```

`list --due` names every active series whose next date has arrived — today in
Zurich — and the period to generate for each. It is the whole discovery
mechanism. Generating before the date is allowed, for billing in advance: the
period you name is the statement of which bill it is, not the calendar.

An occurrence is an ordinary **draft**: the next number in its company's
sequence, the template's client, lines, currency, language and payment message,
dated today unless you pass `--issue-date`. Generating is not sending; send it
like any other invoice, after fetching the PDF.

## Setting one up

A series is copied from an invoice that already exists — its template.

```
bk billing recurrence create --template <ref> --frequency <f> \
  --start <YYYY-MM-DD> --occurrences <n> --label-en "…"
```

Run `bk meta --app-server billing` for the frequencies and what each period looks
like.

- **The start date's day of the month is the series' day.** In a shorter month
  it is that month's last day, and it returns to its own day after: a series
  from the 31st falls on the end of February and the 31st of March.
- **If the template was issued in the start date's period, it IS the first
  occurrence.** It takes that period, the count starts at one, and the next date
  is one step on — so making this month's invoice recurring never leads to a
  second bill for this month. Otherwise nothing is counted yet and the first
  generation is for the start date.
- **The template is a model.** Later occurrences copy what it says at the moment
  they are generated. Its number, reference, external ref and metadata are never
  copied. `--message` on `generate` overrides its payment message — use it when
  the template's message names its own period or number.

## Generating twice is safe

**`--period` is required and never guessed.** It must be the series' next
period, which `show` and `list --due` print. Anything else is refused and
nothing is corrected for you: a typo'd period would be a real bill for a period
nobody asked for.

**A period that already has a live invoice is refused, naming that invoice**,
and nothing is created. So after a timeout, just run the same command again:
either it went through the first time and you are told which invoice it made, or
it did not and it does now. With `--idempotency-key`, a rerun of the same call
returns the same invoice instead of the refusal.

## A void frees its period

A voided occurrence keeps its number and stays in its series, and its period
becomes free. Generating that same period again is a **replacement**: a new
draft, and the count does not move — a void and its replacement are one
occurrence. `generate` says "REPLACEMENT" when that is what it did.

## Changing a series

- **Pause and resume** need no reason. A paused series refuses to generate. Its
  next date does not move while paused, so on resume it is due at once if that
  date has passed — nothing is skipped without anybody noticing.
- **`edit --occurrences`** changes the total. It cannot go below what is done,
  and setting it *to* what is done ends the series now — the record of a
  cancelled contract.
- **`edit --template`** points later occurrences at another invoice of the same
  company.
- **The frequency and the start date never change.** Every past occurrence was
  billed on them. End the series and create a new one.

A series is never deleted. Every change is in `bk billing audit list`.

# Closing a year

Closing is the routine that ends one fiscal year and starts the next. It is the
only thing that produces a later year's opening balances.

Related commands: `bk books exercice list`, `bk books exercice create`, `bk books
exercice close`, `bk books opening list`, `bk books worklist`, `bk books entry
post`, `bk books bilan`.

```bash
bk books exercice create --entity acme --year 2027   # next year must exist
bk books exercice close --entity acme --year 2026
bk books opening list --entity acme --exercice 2027  # what the close wrote
```

## It refuses before it writes anything

**Already closed.** Closing twice would carry the result forward twice.

**Anything still staged.** A staged entry is money that has arrived and nobody
has judged. Closing over it would file a year missing entries somebody had
already been shown. Work the list to the end first.

**A bilan that does not balance.** A year that does not balance cannot be filed,
and certainly cannot become the next year's starting point.

**No next year, or a next year that already holds openings.** The close writes
into the following year; writing over balances somebody already has would be
silent. Open it first with `exercice create`.

## What it does

Every BALANCE-SHEET account carries its closing balance into the next year. That
is the whole point of a balance sheet: what the book owns and owes on
31 December is what it owns and owes on 1 January.

PROFIT-AND-LOSS accounts do **not** carry, and that is not an optimisation. A
fiscal year reports the result OF THAT YEAR (art. 958 al. 2); carrying a charge
account forward would make next year's compte de résultat report money spent in
a year that is already filed.

Instead the year's RESULT — the single figure both statements report — is ADDED
to the retained-earnings account. Added, never assigned: that account is
cumulative and already holds every prior year's undistributed result, so
assigning would erase the book's history in one write. A loss carried forward is
legitimately negative.

The year is marked closed LAST, so a carry that fails leaves a year you can
still close.

## Afterwards

The closed year takes no new entries, its opening balances are frozen, and it
cannot be reopened — by the door and by a database trigger, both.

Something found after the close is corrected in the CURRENT year with a
reversing entry. That is the same doctrine that gives this app no un-post and no
delete: a filed year stays as it was filed for the ten years it must be kept.

Check the result immediately:

```bash
bk books bilan --entity acme --exercice 2027
```

The new year should open balanced, because the old one closed balanced.

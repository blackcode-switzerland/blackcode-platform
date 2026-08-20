# Changelog — b/books app

Breaking and notable changes to the **b/books** app: books (legal entities),
fiscal years, the chart of accounts, the grand livre, the statutory statements,
recognition, sources and pièces justificatives. Newest first. If a command that
used to work now fails, check here first — and check `platform.md` too, which
carries changes to workspaces, members, files, tokens and the `bk` CLI itself.

For how the CLI **works** (rather than what changed), run **`bk guide`** — the
complete usage guide, embedded in the binary, so it always describes the version
you are running. For live values (vocabularies, limits, your books), run
**`bk meta`** and `bk books entity list`.

Surfaced at: `GET /api/changelog` (JSON or `?format=markdown`) and `bk changelog`,
which merge every app's file into one feed by date, each entry tagged with its
app. `bk changelog --app books` filters to this file.

> **Process rule:** every change to a route or user-facing feature must add a
> dated entry here. Timestamp it and describe what changed and how to adapt.
> A change touching shared platform data goes in `platform.md` instead, even
> when this app is what prompted it.

> **2026-08-18 — this file was created.** b/books had no changelog file through
> phases 0–3, so nothing it shipped was reported on the agent surface. Files are
> discovered by reading this directory, so the app appears in `bk changelog` from
> here on.
>
> **Phases 0 to 2 shipped before this file existed.** They are not written up
> below as if they had been announced at the time — a dated log records what was
> said on a date, and back-dating announcements nobody made is worse than the
> gap. What they added is stated once, plainly, in the closing entry, so an agent
> reading `bk changelog --app books` is not left believing this app began at
> phase 3.

## 2026-08-20 — b/books is bilingual: EN / FR, the theme toggle moves, and both header pickers become keyboard-operable

**Not breaking. No route changed and no payload changed.** This is the web
surface: what it says, where two controls live, and how one of them is operated.
The `bk` binary is unaffected and stays English.

### The language switch — and what it does NOT change

Every user-facing string in the app is translated. The switch is in **two
places** — Settings → Preferences, and a quiet `EN` / `FR` in the sidebar — and
both go through one hook, so they cannot disagree.

**It is stored on your blackcode account, not in this browser.** It follows you
to another machine and to b/issues and b/sales the day they support it. The
theme, beside it on the same page, is the opposite — per browser — and the page
says so, because that difference is what it exists to make clear. The mechanism,
the column and the resolution order are in `platform.md`.

**No flash.** The locale is on the session row, so the server resolves it before
it renders a byte and the first paint is already right. `<html lang>` follows it,
including when you switch without navigating.

**Three things are deliberately untouched by it:**

1. **The statutory LINE labels of the bilan and the compte de résultat.** Art.
   959a and 959b fix that wording and the filed document reproduces it, so
   `legal()` returns the French to a French reader and an English one alike. What
   changed is that the English *gloss* beside each line is now rendered only for
   an English reader — a French reader was being shown the same words twice.
2. **Anything exported or filed.** There is no export yet. When there is, it is
   French whatever the reader chose: the setting is about reading, not filing.
   `lib/label.ts` carries that rule where an export would import it.
3. **Server-sent vocabularies.** Recognition states, evidence tiers, source
   statuses and the like arrive from `/api/meta` with their own labels. A second
   language for those is a backend request, not a frontend one.

### The statutory document names now follow the reader

**Decision (Bala, 2026-08-20).** A statement's heading is in the reader's
language, and the legal French name stays visible beneath it:

- an English reader sees **Income statement**, with *compte de résultat* under it;
- a French reader sees **Compte de résultat**, and nothing under it, because the
  two are the same string.

This inverts what shipped before — the French was the `h1` for everybody and the
English was a small gloss — which was right for an English-only product with a
statutory exception and wrong the moment a reader can say which language they
read. Nobody loses the legal identity of the document, and nobody has to read a
language they did not choose. It supersedes the old "English only, French only in
statutory line labels" position; `booksFrontend/DECISIONS.md` D-A is rewritten
rather than appended to.

### The theme toggle moved into the sidebar

It was top-right in the page header; it is now in the sidebar footer, in a row of
icon controls under your name and email — **language · theme · settings · sign
out** — which is where b/issues has always put it. Same arrangement, this app's
own spacing and tokens.

**Signing out asks first.** It was one click; it now goes through the same
confirmation dialog b/issues uses. Two apps disagreeing about whether sign-out
asks was a difference nobody had decided.

### The book and year pickers are keyboard-operable

Both header dropdowns were native `<select>` elements and are now
`PropertySelect`, the shared picker. **A native `<select>` is accessible for
free** and a custom one is a regression unless that is written back by hand, so:
each picker declares what it CHANGES for a screen reader ("Book", "Fiscal year"),
rather than announcing only the current value; the year picker uses the
`noSearch` mode, in which the list itself takes focus on open — the half that
makes it operable from the keyboard at all.

Both were operated with the keyboard alone before this shipped, per picker.
Nothing else about them changed: the year still renders as a plain label when
there is only one, the `closed` chip survives, and a closed year still reads
`2025 — closed` inside the list.

## 2026-08-20 — The monthly compte de résultat is on screen, and a closed year now says so

**Web only. No route changed, no record changed, and no new write door.** Two
gaps between what the backend could already say and what the screens could hear.

**The monthly grid — ticket #64.** `/dashboard/{ws}/income-statement` has two
readings now, chosen by `?view=month` in the address so a monthly view is
shareable and Back undoes the switch. The grid draws one column per month of the
exercice plus the year, the row order is taken once from the annual body and
reused for every column, and the total column and every `résultat` come **off the
wire**: nothing in the view adds a column up. It carries the note the ticket
asked for — art. 959b defines the *annual* statement, a month is not a legal
reporting period, and no column there is filable.

The screen asks for `by=month` **on every load**, so the annual body and the
months are one request and one cache entry. Switching reading does not refetch
and cannot show two moments of one statement. A simplified book is refused before
the breakdown, so it never sees the toggle — including at a bookmarked
`?view=month`, which renders the same explanation the annual view does.

**A closed exercice is now visible.** `bk books exercice close` landed earlier
today and there is no reopen; until now the web reduced the fiscal-year list to
bare numbers and threw `status` away, so a filed year and a live one rendered
identically. The year switcher says it on every book-scoped screen (`2025 —
closed` in the list, a `closed` chip beside the control), and the three statutory
documents — bilan, compte de résultat, patrimoine — repeat it in their heading,
because a statement of a filed year is a different document from a draft of the
same numbers. The working screens deliberately do not; the reasoning is in
`components/books-shell.tsx`.

**For an agent, nothing changes.** `bk books cr --by-month` and
`bk books exercice list` already served both facts. This entry is here because
the two front doors are now in sync, which is the thing that was not true this
morning.

## 2026-08-20 — The compte de résultat can be read month by month

**One new query parameter and one new flag; no route, record or stored figure
changed.** Ticket #64, reported by the operator: the profit-and-loss view shows
a whole year as one column, so "the year lost 10'993.60" is answerable and "and
almost all of it was January" is not.

    GET /api/workspaces/{ws}/compte-resultat?entity=…&exercice=…&by=month
    bk books cr --entity acme --exercice 2026 --by-month

`by=month` adds a `months` array carrying the **real statutory line structure**
per month, not a produits/charges pair. Each month runs through the same
`crFor` the annual statement uses, so nothing here knows what an art. 959b line
is, the two views can never disagree about what a line means, and a change to
the structure reaches both at once.

The annual body is returned **alongside** `months`, unchanged, rather than
replaced: a screen showing a grid still needs its total, and making it ask twice
for two views of one statement would invite them to be read from two different
moments.

**Every month in the exercice appears, including the quiet ones.**
`monthly_flows` on the analytique drops empty months, which is right for a
sparkline and wrong for a grid: columns that come and go cannot be read across,
and the reader cannot tell "no trading" from "no data". A quiet month comes back
as a full set of zero lines — the same rule the annual statement already follows
("every legal line is emitted, including the ones that come to zero"), applied
to the second axis.

Refused for a simplified book, exactly as the annual statement is: art. 957
al. 2 bookkeeping has no compte de résultat to break down, and its monthly
picture is `monthly_flows` on the analytique, which that regime does serve.
`?by=` anything else answers `bad_breakdown`.

### A monthly P&L is a reading aid, not a statement

art. 959b defines the **annual** compte de résultat. A month is not a legal
reporting period: nothing closes at a month boundary, no result is carried at
one, and no column of this is filable. That is why `crByMonth` sits in
`lib/derive/management.ts` beside the other management derivations rather than
in `lib/derive/index.ts` with the statutory statements — the placement is the
documentation.

The invariant that makes it safe to show is pinned in the tests: the months sum
to the year exactly, in total AND line by line, because they are a partition of
the same rows rather than a second opinion.

## 2026-08-20 — Payroll, VAT registration, tax parameters, and switching a rule off

**Four more write doors, one of which unblocks the VAT work shipped earlier
today.** Three holes that were invisible from inside the code and obvious the
moment the CLI was driven the way a person drives it.

### `bk books entity edit` — and the flag that silently switched VAT off

`entity.vat_registered` defaults to **false**, `entity create` never set it, and
nothing could update it. `getTaxSnapshot` gates the entire VAT position on
exactly that flag:

    if (entity.vat_registered) { …compute the VAT position… }

So **every book created through this app reported no VAT position at all, for
ever**, however its entries were booked. That stayed invisible while only the
seeded books were looked at, because the seed writes the flag directly. It also
meant a company crossing the art. 10 LTVA threshold had no way to say so, and
registration is an event in a company's life rather than a property of the day
it was founded.

    bk books entity edit --entity acme --vat-registered \
      --vat-method effective --vat-filing quarterly

Editable: name, seat, the VAT trio, audit status, FTE count, accent, the
art. 957 al. 2 regime election. Vocabularies are enforced — `bad_vat_method`
(art. 37 LTVA), `bad_vat_filing` (art. 35), `bad_audit_status` (art. 727) — and
registering without a method and a period is refused (`vat_needs_method_and_filing`),
because a position nobody can file is not worth computing.

Three fields are **permanent** and refused by name rather than ignored:
`slug_is_permanent` (every URL, command and stored reference names the book by
it), `legal_form_is_permanent` (a re-registration at the commercial register,
with new books), `regime_is_permanent` (art. 957 decides it and 0004 holds it as
a CHECK).

### `bk books tax-params set` / `tax-params show`

`books.tax_params` was `SELECT`-only in the whole application — only the seed
ever wrote a row — so the three demo books had a tax picture and every book a
person created answered `tax: null, configured: false` for ever.

`lib/types.ts` is right that the answer must not be filled in: "the canton and
the commune come from that row and from nowhere else (decision D-D)… a screen
that supplied a default rate would be inventing somebody's tax bill." So this is
a door, not a default.

    bk books tax-params set --entity acme --canton VD --commune Renens \
      --ifd-rate 8.5 --cantonal-base-rate 3.3333 --cantonal-coefficient 155 \
      --communal-coefficient 78.5 --capital-tax-permille 0.6

All five rates are required together: a snapshot built on four of them would be
wrong invisibly. Refuses `bad_canton` (the 26, by code), `missing_commune`,
`bad_rate`, and `no_tax_params_for_simplified` — an RI's result is taxed as its
owner's personal income, which this app does not model and `getTaxSnapshot`
already refuses outright.

This is **configuration**, so it is an upsert: a coefficient that has been voted
replaces the one before it. A snapshot already taken is unaffected (ring 3,
derived at request time, stored nowhere), and an analysis that cited one keeps
its own `based_on` verbatim, which is what that field is for.

### `bk books entry declare --debit / --credit` — an écriture with more than two sides

`--account` plus `--contra` is the two-line shorthand and stays the common case.
A **salary is not that shape and never was**: the mockup's own January payroll is
three lines, 5000 salaires and 5700 charges sociales against 1020. Until now the
door could not express it, so an agent running a company with employees met the
wall every month, and a workspace clone could not replay the seeded entry at all.

    bk books entry declare --entity acme --date 2026-01-25 \
      --label "WIR-SALAIRES JANVIER" --explanation "January salaries" \
      --debit 5000=11600.00 --debit 5700=1750.00 --credit 1020=13350.00

With explicit lines the entry's amount is **derived** from one side rather than
asked for: asking would invite a total that disagrees with the lines it totals.
Refuses `too_few_lines`, `line_without_account`, `line_needs_one_side` (a line
that is both is two lines), `lines_unbalanced` (saying which way and by how
much), and `lines_and_shorthand` — passing both would make the entry unreadable
back. The chart check applies to **every** line, not only the first two.

### `bk books rule deactivate` — a rule taught wrongly was permanent

Teaching a rule is the core loop and the one an agent drives hardest.
`deactivateRule` has existed in `queries/resolve.ts` the whole time and **no
route imported it**, so a rule taught against the wrong fragment, or against an
amount that later changed, kept marking every future import `inferred` and
citing itself, with no way to stop it. The one write in this app that could
quietly get worse over time.

    bk books rule deactivate 8

Deactivated, **never deleted**: `books.entry.matched_rule_id` is a real foreign
key and a posted entry may cite the rule for the ten years art. 958f keeps it,
so what it already explained keeps its explanation and only future imports stop
seeing it. There is no reactivate — teaching it again is one `resolve` away, and
the new rule records what it was learned from and when, which a flag flipped
back would not.

## 2026-08-20 — A book can now be started and a year can now be ended

**Four new write doors, one new migration, and one refusal that changes what
`bk books entry declare` accepts.** Until today the CLI could run the fiscal
year it was already inside — import a statement, work the worklist, resolve,
post, read the statements — and could do neither of the two things at the ends
of it. A workspace clone made the gap concrete on 2026-08-19: every cloned book
opened at zero, because opening balances had no write door anywhere, and every
cloned year opened `open`, because closing had none either.

### `bk books account create` — the chart is a starting point, not a ceiling

`lib/chart.ts` has always said the PME template "belongs to the book once
applied", and `lib/chart.test.ts` pins the proof: the seeded books carry `1021`
(UBS gelée) and `1022` (Yapeal) which the 24-account template deliberately does
not, and the test calls them "a book customization, not template material".
There was no door to make one, so every book created through the app had
exactly 24 accounts forever while the demo books showed 26.

    bk books account create --entity acme --no 1022 --class 1 \
      --label-fr Yapeal --position tresorerie

Refuses `bad_account_no`, `bad_class`, `missing_label`, `account_exists`,
`unknown_position`, and `class_position_mismatch` — a class 6 charge mapped to
a bilan line is refused, because art. 959a and 959b decide which statement a
class reports on. No edit and no delete: entries point at an account by number.

### `bk books entry declare` and `bk books resolve` refuse an account off the chart

**This is a behaviour change on an existing command.** `books.entry_line.account_no`
is a varchar, not a foreign key — the chart is scoped to the entity and the line
only knows its entry — and nothing checked it. A posting to an account the book
does not carry is invisible to every derivation, which walks the CHART and looks
movements up by account, so the credit side simply vanished from the balance
sheet while the debit side counted.

Measured, not theorised: a clone posted CHF 43.70 to `1022` in a book with no
`1022` and produced a POSTED, debit-equals-credit entry whose bilan reported
`balanced: false`, actif 2400.10 against passif 2356.40. The 0004 balance
trigger cannot see this; only the chart knows the account is a ghost.

Both doors now answer `unknown_account`, naming the number and pointing at
`account create`. NULL is still fine: a staged bank line with no account yet is
the normal arrival state from an import.

### `bk books opening set` / `bk books opening list` — the first year is typed

The question this settles is whether openings are typed or produced by a close.
**Both, and the split is the design:**

* a book's **first** fiscal year is **typed** — a migration from whatever kept
  the books before this app, done once;
* every **later** year is **produced** by closing the year before it.

So `opening set` refuses `not_first_exercice` on any other year, and names the
close command in the suggestion. It replaces the **whole set** for the year in
one transaction, never one line, because a balance sheet is one statement that
must balance — which is what lets it refuse `openings_unbalanced` on the day
somebody types the migration rather than at the first close months later.

    bk books opening set --entity martigny \
      --balance 1020=50000.00 --balance 2800=50000.00
    bk books opening set --entity martigny --file balances.json

Also refuses `exercice_closed`, `unknown_account`, `duplicate_account`,
`bad_amount`, and `not_a_bilan_account` (a trading year starts at zero,
art. 958 al. 2). Amounts are in the account's natural direction and 2970 goes
negative for a carried-forward loss.

### `bk books exercice close` — the routine that ends a year

Refuses before it writes anything: `already_closed`, `staged_entries` (money
that has arrived and nobody has judged), `bilan_unbalanced`, `no_next_exercice`,
`openings_exist`, `no_retained_earnings`. Then, in one transaction, it carries
every **bilan** account's closing balance into next year, adds the year's
result to account **2970** (bénéfice / perte reporté(e)), and marks the year
closed last — so a failed carry leaves a year you can still close.

Compte de résultat accounts do **not** carry. art. 958 al. 2: a fiscal year
reports its own result, and carrying a charge account forward would make next
year's compte de résultat report money spent in a year already filed. The
result is **added** to 2970, never assigned: 2970 is cumulative and holds every
prior year's undistributed result.

**There is no reopen and there will not be one.** A closed year has been filed
and art. 958f keeps it as filed for ten years, so something found afterwards is
corrected in the current year with a reversing entry — the same doctrine that
gives this app no un-post and no delete.

### VAT can be recorded on an entry for the first time

`books.entry` has carried `tva_rate`, `tva_amount`, `tva_input_claimed` and
`tva_note` since 0003 and the tax snapshot has served a VAT position off them
the whole time, but **no write door set any of them**. Every figure came from
the fixture writing rows directly, so the VAT position was real for the three
demo books and permanently zero for every book a person actually created.

`bk books entry declare` and `bk books resolve` now take `--tva-rate`,
`--tva-amount`, `--tva-input-claimed` and `--evidence-tier`. Three rules:

1. **The rate is a closed vocabulary** — 8.1, 3.8, 2.6, 0 (art. 25 LTVA), the
   same list `lib/validate/extraction.ts` already enforces on a receipt.
   Anything else answers `bad_tva_rate`.
2. **The amount is derived when omitted and checked when given.** Swiss prices
   are TTC, so the tax inside a gross G at rate r is G × r / (100 + r). A
   supplied figure wins — it is the supplier's own — unless it disagrees by
   more than a rappen, which answers `tva_amount_mismatch`. One rappen of
   tolerance is deliberate: a multi-line invoice legally rounds either side of
   the single-line computation.
3. **A claim needs full evidence.** 0004 already carries
   `CHECK (tva_input_claimed = false OR evidence_tier = 'full')` for art. 28
   al. 1 LTVA; the door now refuses `claim_needs_full_evidence` in words first,
   instead of letting a raw SQL check fire.

On a **posted** entry the rate and amount are frozen (`posted_tva_frozen`) and
the claim is not — exactly as 0004's trigger comment says, because whether you
claim input tax is a position that legitimately moves as evidence arrives. A
recettes-dépenses journal has no VAT columns by design and answers
`tva_not_on_ri` rather than dropping the flags silently.

### Migration 0016 — the guards behind all of it

Three triggers, no schema change, rollback in `docs/sql/books-0016-rollback.sql`:

* `trg_exercice_frozen` — a closed year does not reopen, and its year, dates
  and book are fixed.
* `trg_opening_frozen` — no insert, update or delete of a closed year's
  openings. This also stops the one destructive path the openings door could
  have had, since `set` deletes before it inserts.
* `trg_line_account_in_chart` — the backstop for the chart refusal above, for
  anything reaching the table another way. NULL still allowed.

The doors refuse first because a refusal can carry a suggestion and a SQL
exception cannot.

## 2026-08-19 — The analyses journal renders bare-string questions and verdicts

**Screen and wire-type only; no route or stored record changed.** Third
sighting of the same seam in one day: the journal list and the record header
rendered `question`, `verdict` and `scenario_label` through `en()`, which
answers `''` for a bare string — so analyses #3–#6, filed through
`bk books analyse record` with bare-string speech (legal at the door since
4B), listed as headline-less metadata rows while the seeded `{fr, en}` records
kept their titles. New reader `speech()` in `lib/label.ts` handles both shapes;
`en()` remains for statement labels, which are configuration and always
bilingual. `Analysis.question/verdict/scenario_label` in `lib/types.ts` now
say `Label | string`, which is what the door has always accepted. Frontend
rule of thumb going forward: a RECORD field renders through `speech()`, a
CONFIGURATION field through `en()`.
## 2026-08-19 — "You have no books yet" names the command instead of telling you to ask somebody

**Not breaking. Copy only — no route, payload or command changed.**

The empty-state screen told a reader with no books that opening one is a setup
step this app does not do from a form, and to **"ask whoever set up your
account"**. That was correct on 2026-08-17: `books.entity` did not exist,
`/api/meta` served the seeded books out of a fixture, and there was no create
route on any surface. Naming a command that would fail is worse than naming none.

The table landed, `POST /api/workspaces/{ws}/entities` landed, and
`bk books entity create` landed with them — and the screen kept apologising. The
first person to sign up for their own account read "ask whoever set up your
account", having just set it up themselves, and reasonably concluded the product
would not let them add a book.

The screen now shows the actual command, with the three flags it requires, what
SA and RI each imply for the bookkeeping regime, and the fact that a book still
needs `bk books exercice create` before anything can be posted to it.

**There is still no button, and that part is a decision**: the legal form fixes
the regime for the life of the entity and the registered seat decides the
cantonal and communal tax parameters every later figure is computed with, and
`books.entity` has no delete. It is a CLI act on purpose, and now it says so.

**What to do:** nothing.

## 2026-08-19 — The analyse detail reads bare-string labels, as the door always accepted

**Screen-only; no route, no wire shape, no `bk` command changed.** The analyse
detail's row reader (`figures` / `based_on`) accepted only `{fr, en}` labels,
while `POST …/analyses` has always accepted a bare string (`speaks()`), and the
first real agent filing — analysis #3, filed today through `bk books analyse
record` — used bare strings: a valid record rendered with all thirteen rows
"could not be read". A bare-string label now renders as itself on both language
sides; the record is untouched. One seam stays open on purpose: a bare NUMBER
as `value` files fine at the door but still drops (counted, stated) on screen —
one decision is needed on which side moves, tracked on ticket #56.

## 2026-08-19 — A cost bucket refuses revenue, and every jsonb column now states its shape

**One new refusal; nothing else on the wire moved.**

**`POST …/analytique/categories` now refuses a class-3 account** with
`revenue_not_a_cost` (400). The old check held only `statement === 'cr'`, and
3400 Produits is a CR account — so `bk books category create --accounts 3400`
exited 0 and the management breakdown counted revenue as an ordinary charge
line, indistinguishable from a real cost (found by the frontend review,
2026-08-19). A category buckets costs; produits already carry their own line
on the compte de résultat. Nothing existing changes: no seeded or creatable
category ever held a class-3 account.

**Half-spoken category labels are filled at write.** `{fr: "Divers"}` used to
be stored as given even though the wire contract promises `{fr, en}` on
configuration; the missing half is now copied from the spoken one, exactly as
a bare string always was.

**camt.053: a conversion without its rate no longer stores a partial `fx`.**
The wire contract (2026-08-19 hardening pass) is all three of
`{original, rate, source}` or `fx: null`. The parser used to emit
`{original, source}` when the bank stated no `XchgRate`; that could never
reach the published shape. Such a line now lands with `fx: null` — the bank's
narrative still tells the conversion story.

**Every jsonb column in `lib/db/schema.ts` now declares its storage shape**
via `.$type<…>()` — compile-time only, nothing stored changes. Until now those
columns crossed into TypeScript as `unknown`, which made the wire types the
only guard between the database and a screen (the frontend proved a two-line
edit could break the RI management view with every test green). The shapes are
exported (`StoredSpeech`, `StoredVerdict`, `StoredHistory`, …) so parity tests
on both sides can hold them. Two of them document behavior that was previously
folklore: records keep speech **verbatim** (`string` or `{fr?, en?}` — one
language suffices), and `history` may still be the mockup's original narrative
object until the first append folds it into element 0.

**The write doors, enumerated once** — three documents counted "the writes"
three different ways (five, six, seven), so the ordinals are gone and this
list is the canon. Doors that write RECORDS: `sources/{n}/import` (bank
lines), `pieces/ingest` (extractions), `entries` POST (declare),
`entries/{n}/resolve`, `entries/{n}/post`, `pieces/{n}/match`,
`entries/{n}/verdict`, `analyses` POST (the analyse record). Doors that write
CONFIGURATION or the register: workspaces, entities, exercices, sources
(create/edit/pulls/runbook), rules, analytique categories, invitations, and
`compliance-rules/{rule}` PATCH (review). Sixteen in all. When a count matters,
cite this list, not a number.

## 2026-08-19 — The last four screens: analyses, the analyse record, the tax snapshot, and the compliance register

**Not breaking. No route changed, no `bk` command changed, nothing on the wire
moved.** This is the web surface catching up with four routes that shipped with
phases 4B and 5, all of which are already readable and writable from the CLI:
`GET …/analyses`, `GET …/analyses/{number}`, `GET …/tax-snapshot`,
`GET /api/compliance-rules` and `PATCH /api/compliance-rules/{rule}`. The CLI
remains the complete surface; `bk books analyse list|show`, `bk books tax` and
`bk books compliance list|show|review` do everything these screens do.

**Thirteen screens now exist.** Nothing in this app still renders
`<NotBuiltYet>`.

### What the four screens show

- **Analyses** (`/dashboard/{ws}/analyses`) — the journal of what agents were
  asked about one book, newest first. Read-only, and deliberately: an analysis
  is filed by the agent that answered it, through `bk books analyse record`.
  There is no "new analysis" button and there will not be one.
- **The analyse record** (`/dashboard/{ws}/analyses/{number}`) — one filed
  answer, whole, with its `based_on` snapshot **rendered exactly as filed**.
  Nothing on that page is recomputed and nothing is reformatted: a filed value
  is text the agent wrote, and re-rounding one would be editing the record. Each
  record has its own URL and agents can deep-link it.
- **Impôts** (`/dashboard/{ws}/taxes`) — the statutory position of one (book,
  exercice), derived at request time and stored nowhere. **Every figure names
  the article it rests on**, read from the book's own tax parameters, and a
  figure whose parameter no fiduciary has confirmed says so beside itself. The
  canton and the commune come from the book; nothing is defaulted. Reached from
  the overview's cross-link, not from the nav — tax tracking over time is a
  different product.
- **Compliance rules** (`/dashboard/{ws}/compliance`) — the nineteen statutory
  checks with their citations, their severity, and their source confidence.
  Reached from the overview and from a verdict. It is not book-scoped, because
  the same law binds every book.

### The fifth write is live on the web: reviewing a compliance rule

`PATCH /api/compliance-rules/{rule}` — `bk books compliance review` — now has a
web form. Approve, edit with corrected wording, or reject.

**A review cannot be undone, and the confirmation says so before it appears.**
There is no un-review, no delete, and no way back to `draft`: draft is where a
rule is born, and reviewing backwards would erase the fact that somebody looked.
The row records who and when, from the session.

An edit that carries no corrected wording is refused by the route
(`edited_needs_logic`) and the form shows that refusal **verbatim** rather than
disabling its own button — the route is the rule, and its sentence explains what
an edit legally is in a way a greyed-out button cannot.

**`draft` is not drawn as a warning.** All nineteen rules are draft and that is
the resting state of the screen: research against Fedlex is not a fiduciary's
sign-off, and nineteen researched rules waiting for a human is what this page
looks like when nothing is wrong.

**`source_confidence` is rendered as provenance, not as doubt.**
`needs_fiduciary_check` is a fact about the source — the article behind the rule
is not settled — and it is shown in the same calm treatment as the other two, so
a reader can see which rules rest on statute the agent read in Fedlex and which
rest on something softer.

### The Devil's Advocate's verdict is now visible on every entry

`POST /entries/{n}/verdict` stays what it is: the agent's door, reached with
`bk books verdict`. There is no button anywhere in the web UI that files one,
and this app still computes no compliance judgment of its own.

What is new is that the entry detail screen renders the stored verdict — on
**every** entry, including the ones nothing has ever looked at.

> **`verdict: null` means NEVER CHECKED. It does not mean clean.** A screen that
> drew the absence as an accepted verdict would invent an assurance nobody gave,
> so the absence is rendered as its own state and says what it does not mean.

A `blocked` verdict refuses to post, server-side, and the post form now renders
that refusal as the answer it is — carrying the pass's own resolution text as
the way out. There is no override and no force flag.

### One correctness fix that is not about these screens

A scoped read fired **once without `?exercice=`** on a page opened directly at
`?entity=<slug>`, before the book list had arrived. `resolveScope` answers a
missing year with the book's newest exercice, so that first answer was a real
statement for a year nobody chose, cached as though it had been asked for.
Nothing rendered wrongly — the page holds on a skeleton until the books arrive —
but a book whose newest exercice is CLOSED would have been served from that
cache entry. Fixed; every scoped read now waits for the book list.

## 2026-08-19 — The management view is on the web, and it is the first screen with charts

**Not breaking. No route changed, no `bk` command changed, nothing on the wire
moved.** This is the web surface catching up with two routes that shipped with
phase 4B's backend: `GET /api/workspaces/{ws}/analytique` and
`GET /api/workspaces/{ws}/analytique/categories`. Everything below is already
readable with `bk books analytique` and `bk books category list`, and the CLI
remains the complete surface.

**What it shows** — `/dashboard/{ws}/management`, per book and per exercice:

- The exercice totals for revenue, charges and the net, over the months that
  carry a movement, with the coverage stated.
- Revenue against charges per month, as grouped columns, with the same figures
  in a table beside them.
- Charges by category, each bucket with its accounts, its share and its
  underlying ledger lines.

**Three things it deliberately does NOT show**, so an agent comparing the two
surfaces is not left looking for them:

- **No per-month averages, no runway, and no cash.** The mockup's five "run
  metrics" divide money by a month count; a franc figure produced by dividing a
  parsed float is not a figure this product will print. Cash and runway are not
  on this route at all. The route serving exercice totals, a treasury figure and
  the recorded runway scenarios would let all five come back honestly.
- **No tax panel.** `GET …/tax-snapshot` has its own screen, still to come.
- **No raw/agent payload panel.** Dropped permanently: agents use `bk`.

**And it reads categories, it does not write them.** `POST …/analytique/
categories` exists and `bk books category create` is how a bucket is made
today. Whether the web surface should offer it is an open decision — the
breakdown's buckets are configuration, and this product's web writes have so
far all been interpretation. It is recorded rather than answered.

**One thing for anyone building against the analytique payload.** Two of its
fields cross the wire as untyped JSON: a category's `label` and its `accounts`.
Every `jsonb` column in this app is declared without a TypeScript type and the
other shaping functions cast on the way out; `publicCategory` and
`costBreakdown` pass the column through. A client typing that payload gets
`unknown` for both and has to assert. `label` is `{fr, en}` and `accounts` is a
string array — **or `null`, on a simplified book**, where a bucket is the
category a movement carries rather than a mapping from accounts.

## 2026-08-19 — The hardening pass: every open finding from the frontend reviews, closed

Nine fixes, all of them answers to tickets #50/#51/#53/#55. Four change the
wire — each one flips a pin the frontend deliberately left on the defect, and
the pins now hold the fixed shape.

**Refusals reach callers now, with their reasons:**

- **The 0004 guard speaks (was: a bare 500).** Drizzle wraps a COMMIT failure,
  so the database's sentence sits on the error's CAUSE CHAIN while `e.message`
  says only "Failed query: COMMIT". The post route now reads the chain
  (`sqlErrorText`): an unbalanced post answers
  `400 guard_refused — entry N does not balance: debit X <> credit Y`.
  Frontends carrying the client-side workaround can delete it, as your own
  pin instructed.
- **Every 404 carries its reason and its recovery.** Nine call sites answered
  things like `error: 999`; all now pass the refusal's message and suggestion
  through (`bk books piece match 2 --entry 999` answers "no entry #999 …" with
  the worklist hint).

**Wire changes (all additive or shape-corrections you asked for):**

- **`account.label` is `{fr, en}`** — phase-0-contract.md's promise, kept at
  the door: storage keeps the mockup's `{fr, enSuffix}`, `publicAccount`
  normalizes. `en()` reads an account label like any other; the dedicated
  helpers are gone. A custom label with no English half serves `en: ""`.
- **Patrimoine item amounts are `numeric` strings**, like every other amount.
  The hooks conversion is deleted, per the pin's own note.
- **Entry payloads name their book and year**: `entity` (slug) and `exercice`
  (year) on both journals' rows, list and show. The transaction screen can
  state whose écriture it is instead of inferring it from a URL filter. And
  stated as a decision: a bare `GET /entries/{n}` resolving workspace-wide is
  INTENDED for reads — membership is the gate, and the payload now tells the
  truth about what it found; every write path holds the entity boundary by
  refusal.
- **`fx` is a contract now**: when present, ALL THREE of
  `{original, rate, source}` are — both writers always wrote the whole story;
  the type finally says so.

**The pièce pipeline:**

- **SHA-256 for captured files (migration 0015).** `source.sha256` rides
  ingest (64 hex chars, `bad_sha256` otherwise), dedupe prefers it, and a
  matched entry cites `sha256:…` over Drive's md5. MD5 stays as Drive's own
  cross-check and the legacy key.
- **Duplicate suspects by IDENTICAL FACTS, not just identical bytes.** The
  mockup's own twin pair — the Philfruits receipt and the EFT slip of the
  same purchase — is different bytes and the same money, which checksum
  dedupe could never flag. Ingest now also flags same-date-same-total within
  the same book: `duplicate_of` set, `needs_review` true, never dropped
  (refunds and split payments look identical; a human decides). The seeded
  inbox finally shows the duplicate banner, honestly.
- **`/api/meta`'s `source_types` carry a `note` each** saying whether that
  type is expected to feed a ledger account — so no client invents the
  sentence again that told PostFinance, a bank, that having no ledger account
  is normal. Render the vocabulary's words.

## 2026-08-19 — Phase 5: compliance, retention, and the app that refuses

The last in-app phase. Three routes, one enforcement, one platform answer.

**The 19 compliance rules are served** (`GET /api/compliance-rules`, `bk books
compliance list/show`) — statutory rules researched against Fedlex, each with
its citation, trigger, check logic, consequence, severity (blocker / warning /
info) and `source_confidence`. **Every rule is DRAFT until the fiduciary signs
off**, and the payload says so; render the state. `PATCH
/api/compliance-rules/{rule}` (`bk books compliance review`) records the
sign-off — approve, edit (corrected wording lands in `edited_logic`, the
original stays), or reject — with who and when. No path back to draft, no
delete, ever: a verdict may cite a rule forever.

**Verdicts are the Devil's Advocate's door** — the eighth write, the third for
an outside process. `POST /entries/{n}/verdict` (`bk books verdict`, `--entity`
for an RI number) files a STRUCTURED verdict: `accepted`,
`accepted_with_warning`, or `blocked`, with the `rules` that triggered (each
must exist), `worst_case` and `resolves`. History-first: a replaced verdict
stays in the entry's trail. The rule from #53 applies from birth: an `entity`
that does not own the number refuses with `entry_other_book`.

**One enforcement, server side:** a `blocked` entry refuses to post
(`verdict_blocked`, carrying the agent's own `resolves` text as the way out).
Warned entries post and stay visible. Nothing else is enforced — flags are
facts, and the app computes no compliance judgment of its own.

**Wire change, additive:** `entry` and `ri_entry` payloads gain `verdict`
(null until an agent pass writes one) — pin it as `Verdict | null`.
`/api/meta` gains `verdict_states`, `rule_review_states`, `rule_confidence`.

**The footprint now answers honestly, and the answer is a refusal.** The
scaffold's copy would have hard-deleted solely-owned workspaces — statutory
records included — and counted a table 0007 dropped. Now: a workspace whose
books hold records (écritures, RI entries, pièces, pulls, analyses) reports as
`blocked_by`, and `purge` refuses naming **art. 958f CO** — ten-year
retention. The account may close; the books stay. Only a workspace whose books
recorded nothing purges. **Platform side, take note:** the whole-account close
flow meets its first refusing app.

**Invariants:** DATA-MODEL §17 is now an audited checklist —
`lib/invariants.test.ts` tests what was untested (an SA/Sàrl with simplified
books is refused at `createEntity` itself and at the route,
`sa_needs_double_entry`; « consolidé » is grepped out of everywhere but the
personal overview's disclaimer; the 958f purge refusal) and names the file
pinning each of the other thirteen.

Also: `bk guide books` rewritten for phases 4-5 (statuses and vocabularies
still come from `bk meta`, never from the guide).

## 2026-08-19 — Phase 4B: the management layer, and the agent write-back

Five routes, two of them writes. Everything derived is computed at request
time and never stored; everything filed is permanent.

**New routes and `bk` verbs:**

| Route | `bk` |
|---|---|
| `GET /analytique` | `bk books analytique` |
| `GET /analytique/categories`, `POST` | `bk books category list` / `create` |
| `GET /analyses`, `POST` | `bk books analyse list` / `record` |
| `GET /analyses/{n}` | `bk books analyse show` |
| `GET /tax-snapshot` | `bk books tax` |

**The analytique** (`GET /analytique?entity=&exercice=`): the cost breakdown
per category — each bucket carrying its underlying lines, largest first, an
avoir counted against its bucket — and the `monthly_flows` series (produits /
charges per month, POSTED lines only, exercice-scoped). A simplified book
answers with its dépenses grouped by their own `category` label, uncategorized
under a named bucket; its flows read the directions, and a neutral transfer is
in neither series.

**Categories are per book and writable** — the seventh write. Seeded with the
mockup's five (`personnel`, `bureau`, `it_ai`, `admin`, `autres`) on every
double-entry book. `POST` refuses: an account not in the book's chart
(`unknown_account`), a bilan account (`not_a_flow_account` — a category counts
flows), an account another ACTIVE category already counts (`accounts_claimed`
— one franc, one bar), a duplicate key, a simplified book (`ri_no_categories`).
Labels are normalized to `{fr, en}` on the wire, always. No delete: `retired`
is the exit, and retired rows are served flagged.

**The analyses journal** — the sixth write, and the agent write-back contract
made real. `POST /analyses` files `{entity, asked_by, agent, question,
verdict, figures[], based_on[], scenario_label?, runway_after_months?}`. The
row is APPEND-ONLY: migration 0013 revokes UPDATE and DELETE from the app
role, no edit route exists, and none will. `based_on` items need `label` and
`value` (`based_on_incomplete` otherwise): the snapshot of what the agent READ
is the point of the record, and it is never recomputed. A drifted answer is
re-asked into a new row; both stand. `asked` is the server's clock;
`runway_after_months` is served as a number so charts need no prose parsing.

**The tax snapshot** (`GET /tax-snapshot?entity=&exercice=`): `profit` and
`equity` from the statements, `vat` from the entries' own TVA columns (`null`
when not registered; input counts only when CLAIMED), and the two PM tax
ESTIMATES from the entity's parameter record — canton, commune, rates,
citations, `confirmed` flags, served verbatim under `tax.params`. A book with
no record answers `configured: false` and `tax: null` — an honest "not
configured", never someone else's rates. Two flags worth reading:

- **`capital_tax.confirmed` is `false` on the seeded books, deliberately.**
  The art. 118 imputation question is open with the fiduciary; the snapshot
  serves `gross`, `credited` and `net_due` so either reading is available.
- A simplified book refuses the whole route
  (`no_tax_snapshot_for_simplified`): its result is its owner's personal
  income, which this app does not model.

Nothing existing changed shape: no column moved, no route renamed, migrations
0001-0012 untouched.
## 2026-08-19 — The web ledger reads both journals, and posting is on the web

**Not breaking for `bk`.** No route changed and no payload changed; this is the
web UI catching up to what phase 4A's backend already serves. Two of the three
items below are corrections to screens that were quietly wrong.

### The general ledger now renders a simplified book

`GET …/entries` has served two shapes since phase 4A — the grand livre for a
double-entry book, the recettes-dépenses journal for a simplified one — with, by
design, **no marker field on the payload**: the caller named the book, so the
caller knows which shape it gets.

The web ledger did not branch on it. On a simplified book it was drawing
recettes-dépenses movements through grand-livre columns: no amount and no
direction shown at all, a blank journal number, a blank posting status, "This
entry has no lines." on every row — and each row linked to `/ledger/{n}`, which
reads the double-entry journal, so following one **opened a different book's
écriture** under the simplified book's name. The two journals keep separate
number series, which is why the numbers resolved.

It branches on the book's `bookkeeping_regime` before it reads a row now, and
renders the simplified journal with its own columns (date, movement, category,
direction, amount). Those rows are deliberately **not** links: nothing serves one
recettes-dépenses movement on its own.

*Nothing to adapt for an agent.* `bk books entry list --entity <simplified-book>`
was always correct and is unchanged.

### `?status=` and `?account=` are no longer sent to a simplified book

Those two filters are **refused** by an RI journal (400 `ri_no_such_filter`),
not ignored. The web UI was sending both: the ledger's status filter, and the
income statement's account drill-down, which appends `?status=posted` so a figure
reconciles to its own drill-down.

The chart of accounts renders for a simplified book too, so every account number
on that screen was a link to a 400. Those numbers are now shown as facts rather
than as drill-downs — a simplified book has no chart mapping to drill into — and
a URL that still carries either filter says on the page that it was not applied
rather than dropping it silently.

### Posting a staged entry is on the web

`POST …/entries/{n}/post` and `bk books entry post` have both existed since
phase 1; the web UI had no way to do it. It is on the entry detail page now, for
a staged entry only.

It is not an ordinary button, because posting is the one write in this product
with no undo: it moves a line into the immutable record, where nobody — human or
agent — can modify or delete it, and a correction becomes a new reversing entry.
So it **requires the entry's #number to be typed back** before it will submit,
the way `bk workspace delete <slug> --confirm <slug>` requires the slug, and it
states what freezes (date, amounts, accounts) and what stays open (the
explanation, counterparty, recognition state and supporting document).

**`already: true` is rendered as "already posted", not as an error**, matching
the route's deliberate idempotency: an agent that retries has not failed.

### Known defect, not fixed here: the 0004 guard's refusal never reaches a client

Migration 0004 checks at COMMIT that a posted entry balances, carries at least
two lines and has every line mapped. The route means to translate that refusal
into `guard_refused` (400) with the database's own sentence. **It cannot, and
never has.** Under drizzle-orm 0.45 a failure raised at COMMIT arrives wrapped,
with the database's message on the error's `cause`, so the route's check never
matches and the refusal surfaces as **500 `internal_error`** — on `bk books entry
post` exactly as on the web form.

Reproduced with an entry whose two lines are mapped and unbalanced (77.00 against
99.00): 500 on both surfaces, while the same statements in `psql` answer *"entry
1272 does not balance: debit 77.00 <> credit 99.00"*.

*How to adapt:* a 500 from `bk books entry post` means the entry was **not**
posted and is unchanged — the transaction rolls back whole — and almost always
means it failed one of those three conditions. `bk books entry show <n>` and its
lines are what the guard reads. This is a route fix and is tracked; the message
will start arriving as a 400 with a real sentence.

## 2026-08-18 — The match write holds the entity boundary

The phase-3 review found that `POST /pieces/{n}/match` could attach a pièce to
**another legal entity's** grand-livre entry: `entry.seq` is workspace-unique,
so any book's number resolved, and only the recettes-dépenses branch checked
whose it was. In doing so it could also silently replace evidence an entry
already carried — on the reviewer's repro, a posted entry's Drive reference and
sha256, overwritten with no record. That write was withheld in the UI behind a
flag. Fixed server-side; the flag can come off.

**Two new refusals**, same shape as every refusal (`code`, message,
`suggestion`), HTTP 400:

- **`entry_other_book`** — the piece is attributed to one book and the number
  names an entry in another. The worklist's `suggested_entries` were already
  scoped to the piece's own book; the write now enforces what the suggestions
  promised.
- **`entry_documented`** — the entry (either journal) already carries a pièce.
  Evidence is never replaced silently; a second document for the same entry is
  a feature nobody has needed yet, on purpose.
- (`already_matched`, on the piece side, is unchanged.)

**Two behaviours a client may rely on:**

- **The match is recorded in the entry's `history`** — the same append-only
  trail `resolve` keeps: `{at, event: "piece_matched", piece, was}`, where
  `was` holds the (empty, the guard proves) prior `piece_*` fields.
- **Matching an unattributed piece attributes it.** A piece with no book may
  still match any grand-livre entry, and saying which entry it documents says
  whose it is: `piece.entity_id` is set from the entry in the same
  transaction. It cannot reach a recettes-dépenses book while unattributed,
  as before.

No route added or renamed, no wire field changed. `bk books piece match`
surfaces the new refusals as-is.
## 2026-08-18 — Web screens corrected: the overview under-counted, and a transaction named the wrong book

Hardening pass over the twelve built screens. **No route changed and no `bk`
command changed** — every fix below is in the web UI, and in two places the web
UI is now saying what `bk` was already saying.

**Breaking for nobody. Read this if you compare the web figures against `bk`.**

- **The overview's "Need a human" was the wrong number, and `bk` was right.**
  `GET …/overview` serves both `unrecognized` (strictly
  `recognition = 'unrecognized'`) and `worklist` (`unrecognized` OR `inferred`,
  which is what the Recognition queue actually lists and what
  `bk books overview` prints under `TO RESOLVE`). The web read the first and
  labelled it "Need a human". On the seeded workspace it showed **4 where `bk`
  totalled 5**, and per book "2 unrecognized" where `bk` said 3. The web now
  reads `worklist` and the two agree. `unrecognized` is still served and is
  still the right field if you specifically mean that state.

- **The transaction screen stated a book and a fiscal year it does not know.**
  `GET …/entries/{number}` resolves on `workspace_id + seq` and is **not scoped
  by entity or exercice** — correctly, because `books.entry.seq` is
  workspace-wide. The screen was printing the book and year from the URL's
  `?entity=` / `?exercice=` filter beside the entry, so opening one book's
  écriture and changing the book selector relabelled that unchanged entry with
  another company's name. It no longer names either. **If you consumed that
  heading as the entry's book, it was never that.** The payload carries neither
  field; serving them is an open backend request.

- **The Recognition screen treated "this book has no fiscal year" as a failure.**
  Every book starts with no exercice (`bk books entity create` opens none), so
  this was the first screen a new book showed, and it showed two red alert boxes
  printing the raw `bad_scope` code. It now renders the same calm explanation
  the balance sheet and income statement already used, carrying the server's own
  `suggestion` (`bk books exercice create --year …`).

- **An entry's original-currency block is rendered.** `fx` (`{original, rate,
  source}`, migration 0011) is described as display-only and was displayed
  nowhere. The transaction screen now shows it when present, field by field —
  absent fields are omitted rather than dashed, because the writer may omit any
  of them. Nothing computes with it; amounts stay CHF.

- **The pièces inbox now says why it cannot attach a document.**
  `POST …/pieces/{n}/match` and `bk books piece match` both work, and the web
  form for them is deliberately switched off. The screen said nothing about it,
  so six documents sat there unactionable with no explanation. It now states the
  reason. **Note for anyone reaching for the CLI as a workaround: there is not
  one.** `matchPiece`'s grand-livre branch resolves the entry on
  `workspace_id + seq` with no entity filter, so
  `bk books piece match <p> --entry <n>` will attach a pièce across two legal
  entities and exits 0 — verified against seeded data, where a blackcode SA
  receipt attached to an AIOS Companion SA écriture and overwrote that entry's
  existing Drive reference and SHA-256 with a NULL hash, leaving `evidence_tier`
  untouched and writing no history. Do not use it across books until the route
  filters by entity.

## 2026-08-18 — Sources, pièces and the fifth write

Phase 3's screens are live in the web UI. **No route changed**, so no `bk`
command changed either: everything below reads or writes through routes and
commands that shipped with phase 3's backend.

**New screens.**

- **Accounts & sources** (`/dashboard/{ws}/sources`) now carries the sources
  register beside the chart of accounts — every bank, card, processor, SaaS
  spend and Drive folder, with the **computed** completeness status and the
  thresholds behind it. `bk books source list`.
- **Source detail** (`/dashboard/{ws}/sources/{number}`) — the freeform notes,
  the ledger accounts fed, the pull runbook, the raw files pulled, and the
  worker's file manifest. `bk books source show`, `bk books manifest`.
- **Supporting documents** (`/dashboard/{ws}/documents`) — the receipts inbox,
  one row per captured document, with the server's own validation verdict and
  the extracted lines. `bk books piece list`.

**Not breaking, and worth knowing:**

- **The register and the inbox are not filtered by book.** A source can feed
  more than one, and both `books.source.entity_id` and
  `books.piece_inbox.entity_id` are nullable — an unattributed source or a
  scanned receipt that does not say whose it is would be hidden by a filter, and
  those are exactly the rows a person is looking for. The book is a column on
  both. `bk books source list --entity <slug>` still narrows.
- **A source's status is computed at read time** from cadence against
  `last_import` and is not settable anywhere, by anybody. There is no status
  column and there will not be one. The only hand-set lifecycle fact is
  `retired`.
- **A flagged pièce is normal traffic.** A document that fails validation still
  lands, staged and flagged; duplicates are flagged and never dropped. Neither is
  drawn as an error.

**The write count went from four to five — and the fifth is WITHHELD in the web
UI for now.** Attaching a pièce to the entry it proves is
`POST /api/workspaces/{ws}/pieces/{n}/match`, `bk books piece match`. It writes
the entry's document reference, checksum and capture date, and **deliberately
does not change the entry's `evidence_tier`**: whether a receipt is sufficient
proof is a judgment, and judgments stay human.

> **Superseded 2026-08-18, same day.** The route now refuses a cross-book match
> and the web control is switched on. See "The match write holds the entity
> boundary" above. The warning below is kept because it was true when written,
> and anyone reading a version of this app from that day needs it.

**Use `bk books piece match` with care until further notice.** The route resolves
its `--entry` number against the grand livre on workspace and number alone, with
no book filter, so **a pièce belonging to one legal entity can be attached to
another entity's entry** — and doing so overwrites any document reference and
checksum already on that entry, without recording anything in its `history`. A
simplified book's journal is not affected; it filters correctly.

The web UI's control was therefore built and switched off rather than shipped.
**It is on since 2026-08-18**, once the route's refusal was verified in both
directions — it refuses a pièce from another book, and it still accepts one from
the same book.

**One client-visible fix.** `entry.piece.hash` and `entry.piece.captured` are
**nullable** and always have been — `books.entry.piece_hash` is a nullable
column. A client typing them as non-null will break the first time it reads an
entry whose pièce was attached by `match` from a document with no checksum,
which is every document the current capture pipeline produces. Nothing on the
wire changed; the shape is being stated because it was previously mis-declared
on our side.

---

## 2026-08-17 — Everything before this log existed (recorded late, 2026-08-18)

**Not an announcement.** This entry was written on 2026-08-18, after the fact,
because phases 0 to 2 shipped before anyone created this file and an agent
reading only the entry above would conclude b/books began with sources and
pièces. It says what exists and where to read the contract; it does not pretend
to have been published on the date in its heading.

**The app.** `apps/books`, its own `books.*` Postgres schema and role, sharing
one blackcode account with every other app. One workspace holds any number of
**books** (legal entities); each book keeps its own chart of accounts, its own
fiscal years and its own statements, and two books never mix.

**The routes, all workspace-scoped under `/api/workspaces/{ws}/`:**

| Route | `bk` |
|---|---|
| `entities` (GET, POST) | `bk books entity list` / `create` |
| `exercices` (GET, POST) | `bk books exercice list` / `create` |
| `accounts` | `bk books account list` |
| `entries`, `entries/{n}` | `bk books entry list` / `show` |
| `bilan` | `bk books bilan` |
| `compte-resultat` | `bk books cr` |
| `overview` | `bk books overview` |
| `patrimoine` | `bk books patrimoine` |
| `worklist` | `bk books worklist` |
| `rules` (GET, POST) | `bk books rule list` / `create` |
| `entries/{n}/resolve` (POST) | `bk books resolve` |

`GET /api/meta` is the dynamic contract — vocabularies, VAT rates, the statutory
line structures — and never the data. **It does not carry the books or the
fiscal years**: those are workspace-scoped rows and are read from `entities` and
`exercices`.

**Four things a client must get right**, each of which has already broken one:

- **Money is a string on the wire** and stays one. `numeric(14,2)` does not fit a
  float, and a bilan balances to the rappen.
- **Dates are plain dates**, not instants. Parsing `"2026-01-05"` into a
  timestamp moves a booking across a year boundary for anyone west of Greenwich.
- **A simplified book has no bilan.** `GET …/bilan` refuses it with
  `no_bilan_for_simplified` and points at `patrimoine`. That is correct, not an
  error, and permanent — confirmed 2026-08-18.
- **The worklist merges three tables** (`entry`, `ri_entry`, `piece_inbox`) whose
  `seq` counters are separate. **`POST /entries/{n}/resolve` addresses
  `books.entry` only**, so resolving a row of any other kind by its number
  rewrites an unrelated journal entry. Read `kind` before acting on `number`.

The full design record is `docs/books-app-plan/`, and the frontend contract is
`apps/books/docs/frontend.md`.

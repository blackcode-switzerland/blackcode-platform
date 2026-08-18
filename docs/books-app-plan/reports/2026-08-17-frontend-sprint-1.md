# b/books frontend — sprint 1 handoff

**To:** the backend dev
**From:** the frontend side
**Date:** 2026-08-17
**Landed as:** `57f687a` on `feat/books-phase-0`

> **This is a dated record, not a live document.** It says what was true on
> 2026-08-17. Where it asks for something that has since been answered, the
> answer is elsewhere and this stays as it was written.
>
> It cites two agent reports — an implementor's and an independent tester's —
> which live in a **gitignored** working folder and are not in this repo. What
> mattered from them is reproduced here; ask the frontend side if you want the
> originals.

Sprint 1 is built, independently tested, and the findings are fixed. This is what
changed, what we need from you, and the two things that need a decision rather
than a fix.

> **If you read one section, read §3.** Books is missing three routes that an
> existing platform decision (D-21, plus the Tier 1 list sales shipped against)
> says every deployed app has — including `/api/cli/authorize`, which means
> `bk login --server <books-url>` will 404 the day books deploys. All are shared
> factories. It is also why the settings page has one tab where sales has four.

**Nothing under `app/api/`, `lib/db/`, `cli/` or `packages/` was touched.**

---

## 1. What we built

The foundation the frontend side planned, top to bottom:

providers (TanStack Query, themes, toaster, session) · the amber theme · the app
shell with the nine-item sidebar in the mockup's order · book and year switchers ·
a real login/signup form · the marketing page · account settings · the
zero/one/many-book states · eight of the nine shared components.

Gates, from the repo root: **typecheck 12/12, tests 6/6 (books 7 files / 69
tests), lint 0 errors, build 4/4.**

Detail is in the implementor's report (see the note at the top) — it
records the decisions it took where the plan was silent, and it is candid about
what its own checks did not ask.

## 2. What we then found, and fixed

An independent tester drove the build in a browser and read the database, and
reported separately. Its verdict was that the foundation is safe to build on. It
found seven things. **Four were in files you wrote in phase 0**, which is why
this section is addressed to you rather than filed as our own bug list.

### Fixed — `lib/format.ts` no longer parses money into a float

**This is the one to read.** `money()` was `group(amount(value))`, and `amount()`
is `Number(value)`. So every franc the app would ever render went
string → float64 → `toFixed(2)` → string, three lines below `amount()`'s own
docstring saying *"never use this to compute a figure that is then displayed as
money"*.

It was **latent, not live** — nothing renders an amount yet — and it is
**measurably lossless for every value `numeric(14,2)` can hold** (20 000 sampled
values round-trip identically; the tester sampled 200 000 with the same result).
The exposure is a wire value with more than two decimals, which is what a VAT
computation produces:

| Wire value | Was | Now |
|---|---|---|
| `"0.145"` | `CHF 0.14` | `CHF 0.15` |
| `"1.005"` | `CHF 1.00` | `CHF 1.01` |
| `"1e3"` | `CHF 1'000.00` | `—` |

The display path is now string-only: the digits are grouped textually and rounding
is decimal, half away from zero — what a person does on paper and what Postgres
`numeric` does. **Output is byte-identical for every in-range value**, which was
the constraint; this removed a fault without restyling anything.

`lib/format.test.ts` is new and holds it: 24 cases, including a randomised
comparison against the old implementation over the full column range. Every
assertion was watched fail before being kept — the true bug reddens 8 cases, and
the parity suite correctly stays green (old and new agree in range, which is the
discrimination working). One case list in it is shorter than its first draft
because the suite's own "do these inputs distinguish the fix from the bug?"
assertion failed and named two cases that did not.

### Fixed — the read-only guard walked three directories

`read-only.test.ts` and `query-keys.test.ts` walked `app`, `components` and `lib`,
and nothing asserted those were the whole surface. The tester put a component
containing `fetch('/api/…', {method:'POST'})` in `apps/books/features/` and **all
41 tests passed.** We replayed it and watched it happen.

Both scanners now walk the app root and subtract a named exclusion list, and two
new assertions keep that honest: the list must be non-empty and every entry must
still exist, and the walk must reach `middleware.ts` (a file outside all three of
the old directories). Replaying the escape now reddens three checks.

This is the arrangement `platform-testing/test/cited-tests-exist.test.ts` uses,
for the same reason.

### Fixed — an aliased import walked past the write guard

The write check matched the literal token `apiSend`, so
`import { apiSend as send }` and then `send(…)` passed. The import is now the
chokepoint — you cannot alias what you did not import — and a second check bans
naming `fetch` at all outside `lib/client.ts`, which closes `const f = fetch` and
`window.fetch` too. (`\bfetch\b` does not match `refetch()`, which several
components legitimately call.)

Replayed the alias escape: it reddens exactly the one new check, so it
discriminates rather than blanket-failing.

### Fixed — three chip colours failed WCAG AA in the light theme

Chips mix each served colour toward `--foreground` so one served hex works in both
themes. The ratio was a hardcoded 62%, and in the light theme that put three of
the seven served colours under 4.5:1 on 10px uppercase text — including the amber
that carries *inferred*, *partial*, *staged*, *extracted* and *validated* across
five of the seven vocabularies. The recognition screen is made entirely of these.

The ratio is now the `--chip-mix` token, per theme: 48% light, 62% dark
(unchanged — dark was never the problem, at 8:1 and up). Measured in the real
browser, with the instrument validated against four known answers first:

| Colour | 62% (before) | 48% (now) |
|---|---|---|
| amber — inferred / partial / staged | **4.26 ✗** | 6.12 |
| entity amber | **4.32 ✗** | 6.19 |
| entity cyan | **3.99 ✗** | 5.86 |
| green / red / grey / entity violet | 5.66–7.14 | 7.72–9.16 |

The live chips on the overview measure 6.19, 5.86 and 7.59 — the predicted values.

**Nothing about the served colours changed.** They still come from `/api/meta` and
must never be hardcoded; only how far the UI pulls them toward the text colour did.

### Fixed — the mobile drawer

Escape did nothing, and the drawer's links sat before its trigger in tab order,
so a keyboard user who opened it and pressed Tab moved *away* into the page
behind: menu open, focused nowhere, unreachable in the direction anybody tabs.
Escape closes it now, opening moves focus inside, closing returns focus to the
trigger, and it carries `role="dialog"` / `aria-modal` / `aria-expanded`.
Verified at 390×844.

### Fixed — signing up with an existing address said nothing useful

Found by a human on 2026-08-17, trying to sign up with their own address. Both
agents missed it.

`POST /api/auth/register` returns exactly the right thing for an address that
already has a blackcode account:

```json
409 {"error":"Email already registered",
     "suggestion":"Sign in instead, or use a different email"}
```

The form showed **"Could not create your account."** — its generic fallback.

The route was right, `lib/client.ts` was right, and the form was written to print
the server's words verbatim. The failure was in between: `lib/account.ts`'s `run`
recorded the error in React **state**, and the form read `register.error`
immediately after awaiting `run` — same tick, before any re-render, so it was
always `null`. Every failure of every account write showed its fallback string,
including a failed profile save.

`apps/sales/components/login-form.tsx` does not have this bug because it lets the
error throw and catches it, which is synchronous. Books now returns a result
(`{ok: true, data} | {ok: false, error, message}`), so the caller cannot reach the
data without going past the failure, and there is nothing to read out of state at
the wrong moment. A 409 also now carries the reader to the sign-in tab with the
reason and their email intact.

**Why neither agent caught it:** Agent 2 verified the profile save's *success*
path — toast plus the database row — and no test or check ever exercised a failed
account write. It is CLAUDE.md finding #21 from the other side: there, a positive
case was satisfied by the error path; here, the positive case passed and the error
path was never run at all.

## 3. The account surface: books mounts 7 routes where sales mounts 20

Raised because the settings page looks thin next to sales', and the reason is not
that it is unfinished — it is that three of sales' four settings tabs have no
backend in this app.

| Sales settings tab | Needs | In books |
|---|---|---|
| Profile | `PATCH /api/me` | ✅ built |
| Account (password) | `/api/me/password/request-otp`, `/confirm` | ❌ no route |
| API tokens | `/api/tokens`, `/api/tokens/[id]` | ❌ no route |
| Preferences | a `user_preferences` table + route | ❌ no table |

We are not building any of those three: a tab that cannot persist anything is
worse than an absent tab, and we do not add routes.

**And one that matters more than the settings page.** Books has no
`/api/cli/authorize` and no `/cli/authorize` page. That is the endpoint
`bk login` opens (`cli/internal/commands/platform/login.go:320`), and `bk token`
hits `/api/tokens`, which books also lacks.

Nothing is broken today: `login` and `token` are bare verbs that talk to whichever
app you are homed on, and identity is shared, so a token minted on issues or sales
authenticates against books fine. **But nobody can home on books**, and a person
whose only access is books cannot obtain a token at all.

**No guard catches this.** `cli-parity` checks routes→commands, never
commands→missing host. `platform-route-coverage.test.ts` only asserts every
platform command is mounted by *at least one* app, so sales mounting `/api/tokens`
keeps the suite green. That is precisely the "another app serves this" versus
"nobody serves this" distinction, and CLAUDE.md's recorded test for a legitimate
subset is *"does every bare verb have a host from this app's login?"* — for books,
`login` and `token` currently do not.

### This is not an open question — D-21 already decided it

We went looking for whether books' subset was deliberate, and found that the
platform has already ruled on it. From `apps/sales/app/api/cli/authorize/route.ts`,
its own header:

> D-21 makes this **Tier 1 for EVERY deployed app**. `bk login --server
> https://sales.blackcode.ch` is a legitimate command — an agent naming the app it
> is about to work in — and a **404 there is the invisible failure D-1 exists to
> remove**.

The decision is recorded in `docs/cli.md:1011` and in `docs/sales-app-plan.md`
(D-21, 2026-08-06: *"Every deployed app serves `/api/cli/authorize`"*). That plan's
Tier 1 list — the routes that had to exist **before sales shipped** — names
`/api/cli/authorize`, `/api/tokens(/[id])` and `/api/me/password/*` explicitly.

So books is not exercising a legitimate permanent subset here. It is missing three
things an existing platform decision says every deployed app has, and `bk login
--server <books-url>` will 404 the day books deploys.

**The good news: all of these are shared factories**, mounted rather than written.
Sales' `app/api/tokens/route.ts` is nine lines of comment over a factory call, and
the factory enforces its own safety rule at mount time (it throws if the app's
`AppContext` supplies no `resolveSessionUser`, so a bearer token can never mint
another one).

### What we are asking you to mount, in priority order

| # | Route | Why | Unblocks |
|---|---|---|---|
| 1 | `/api/cli/authorize` + the `/cli/authorize` page | **D-21, required before books deploys.** `bk login --server` must not 404 | `bk login` against books |
| 2 | `/api/tokens`, `/api/tokens/[id]` | Tier 1. Also what the revoke UI needs from this origin (D-10) | the **API tokens** settings tab |
| 3 | `/api/me/password/request-otp`, `/confirm` | Tier 1. Needs `@blackcode/platform-email`, which books does not depend on yet | the **Account** settings tab |
| 4 | `/api/auth/password-reset/request`, `/confirm` | the signed-out half of the same story | password reset from `/login` |
| 5 | a preferences table + route, **only if you want it** | sales' is `sales.user_preferences`, keyed per (user, workspace). This one is genuinely optional and not in any Tier 1 list | the **Preferences** settings tab |

Items 1–4 are not requests, they are a platform requirement books has not met yet.
Item 5 is a real choice, and if the answer is no, that is fine and gets written
down.

**Each needs its `bk` command and changelog entry in the same commit**, per the
three-places rule — which is another reason these are yours and not ours.

**What we will build the moment each lands:** the settings page grows the Account
and API tokens tabs, matching sales' four-tab layout. Until then it stays Profile
plus Appearance, because a tab that cannot persist anything is worse than an absent
one. We are not building stubs.

## 4. Two things that need a decision, not a fix

### D-1. The negative sign disagrees with the mockup

`format.ts`'s own header says phase 1's acceptance test compares this app's output
**string for string** against the mockup — that is why the ASCII apostrophe was
chosen over U+2019. By the same standard the negative sign is wrong twice over.
Confirmed by hexdump of `bbooks-data.js`:

| Amount | Mockup | books |
|---|---|---|
| `-1234.50` | `−CHF 1'234.50` | `CHF -1'234.50` |

Two independent differences: the **character** (U+2212 MINUS SIGN vs ASCII hyphen)
and the **position** (before `CHF` vs after). Positives, zero and null all match.

**We did not change it**, because which one moves is a specification question and
picking one silently is how a parity test gets "fixed" later by whoever it
surprises. Today's output is preserved exactly and the decision is now two
constants in one place — `MINUS` and `MINUS_LEADS_CURRENCY` — so answering it is a
two-line edit wherever the answer lands.

**We need:** the mockup is the spec, so our reading is that the app should move.
Confirm, or tell us the mockup is wrong here.

### D-2. The statement pages ignore `bookkeeping_regime`

`/api/meta` serves the RI book as `"bookkeeping_regime": "simplified"` with a
`regime_note` explaining that it keeps income/expense plus net-worth bookkeeping
under art. 957 al. 2 CO. Navigate to `?entity=ri` and you get **the full 25-line
art. 959a balance sheet, captioned "art. 959a CO"** — identical to the two SAs.
The `regime_note` you send renders nowhere.

This is the RI question from `00-decisions.md`, and the reason nobody caught it is
that it was written down as a question about the *ledger* screen. It had already
landed on the two statement screens that shipped.

**We need the answer we asked for in `03-backend-handoff.md` item 3**, and now it
blocks something that exists rather than something we have not started: is the RI
single-entry in the first pass, per the mockup and `SCOPE.md`, or does
`week-one.md`'s voluntary-double-entry shortcut hold? We are not guessing at what
a simplified-regime entity does or does not file.

## 5. Still needed from you

Unchanged from `03-backend-handoff.md`, in priority order:

1. **Fixture data through routes, not files.** Still the thing that blocks sprint
   2. Your `/api/meta` `source: "fixture" | "database"` pattern is exactly right —
   we want the rest of the payloads the same way, `analytique` first (our first
   screen, your last phase). That one alone unblocks weeks.
2. **The RI answer** — D-2 above.
3. **Raw agent surfaces: confirmed dead?** The mockup's premise is "the page IS
   the API"; this platform's rule is that agents use `bk`. We built no
   `RawSurface` on the assumption `bk` replaces it. Confirm, because that
   assumption only holds if `bk books` grows the read verbs — today it has one
   placeholder verb.
4. **`lib/types.ts`'s `BooksMeta.entities`** declares `Entity[]`; the route serves
   `{source, note, data}`. The route is right and the type is stale — typing a
   screen against the declaration compiles clean and reads `undefined` at runtime.
   Five lines on your side. We typed against the wire and left your file alone.
5. **The account surface — §3.** Not repeated here: items 1–4 of that table are a
   platform requirement (D-21 and the Tier 1 list), not a request, and item 1
   blocks the deploy rather than blocking us. Settings currently tells people to
   change their password in b/issues or b/sales, which is true and is not a good
   answer.
6. **One sentence for the zero-books screen:** what does a person with no books
   actually do next, once phase 1 lands? Our copy is provisional and offers no
   button, because `books.entity` does not exist and neither does a `bk` spelling
   for creating one.
7. **Account deletion needs a human, not either of us.** Books cannot delete for
   ten years (art. 958f CO) and `AppContext.footprint` has to answer anyway. The
   settings page states what is true today and stops.

## 6. Files we changed that are yours

Flagged rather than assumed. All are one edit to revert.

| File | What | Why |
|---|---|---|
| `lib/format.ts` | display path is string-only; sign constants extracted | §2 and D-1 |
| `lib/read-only.test.ts` | allowlist widened to `lib/account.ts` (Agent 1); walk inverted + two new checks (us) | §2. Agent 1's §5.1 argues the widening; we re-proved it fires by adding a third writer |
| `lib/query-keys.test.ts` | same walk fix | §2 |
| `apps/books/docs/frontend.md` | §7 rewritten — it described an absence ("no TanStack Query, no shell, no theme") that no longer exists | the docs-sync rule. Nothing else in that file was touched |

## 7. What is not covered, stated plainly

- **"The book switcher busts the query cache" is not proven and we are not
  claiming it.** What is proven is that the key builder separates books and that
  no hook builds a key another way. There is no per-book route yet, so there is no
  cached payload to watch go stale. **The first hook that fetches per-book data is
  where this becomes observable, and it must be watched then** — this is the worst
  bug class this app can have.
- **The em-dash-vs-`0.00` decision is a decision, not a verified behaviour.**
  There is nothing to compare against until a derivation route exists. The rule we
  wrote down: an unknown amount is an em dash, a derived zero is `0.00`, and never
  render the first as the second.
- **No screen has rendered a real amount yet**, so none of the money formatting
  has been seen end to end through a route. It is held by unit tests.
- **`bk` was not run.** No CLI work was in scope and no route was added.

# b/books — frontend

**This app only.** Platform-wide conventions, the tokens, the
`@blackcode/platform-ui` primitives, the app shell pattern, are in the root
[`docs/frontend.md`](../../../docs/frontend.md) and are not repeated here.

**Status: phase 0 complete, 2026-08-17.** The contract exists. No b/books screen
exists yet. One books route is live. What each phase turns on is in
[`docs/books-app-plan/`](../../../docs/books-app-plan/README.md).

---

## 1. Run it

`.env.local` is gitignored, so you create it. Four lines:

```sh
# apps/books/.env.local
DATABASE_URL=postgres://blackcode:blackcode_dev@localhost:5434/blackcode_issues
NEXTAUTH_URL=http://localhost:3200
NEXTAUTH_SECRET=<openssl rand -base64 32>
# Never set RUN_MIGRATIONS locally. It belongs only in Vercel Production.
```

Then, from the repo root:

```sh
docker compose up -d          # Postgres 16 on localhost:5434
npm install
npm run db:migrate:books      # creates the books schema
npm run dev:books             # http://localhost:3200
```

books is 3200. issues is 3000, sales is 3100.

The database name is `blackcode_issues` and that is not a mistake. One local
Postgres holds every app, each in its own schema. `platform.*` is shared,
`books.*` is ours, and we may not read another app's.

Check it worked:

```sh
curl -s localhost:3200/api/meta | head -c 300
```

## 2. What is actually live

**One books route: `GET /api/meta`.** It is unauthenticated on purpose, the same
as the platform's own. It serves:

| Key | What |
|---|---|
| `entities` | the books. `source: "fixture"` today, `"database"` from phase 1 |
| `exercices` | the fiscal years present |
| `vocabularies` | seven of them, colour and icon included |
| `tva_rates` | 8.1, 2.6, 3.8, 0 |
| `statements` | the legal line structures of the bilan and the compte de résultat |

Everything else under `app/api/` is platform scaffold: auth, `/api/me`,
workspaces, members, invitations. `notes` is a placeholder and is deleted in
phase 1. Do not build on it.

`entities.source` is the field to watch. A screen that ships against fixture data
believing it is real is the failure that field exists to prevent.

## 3. Two rules

### Never import the fixture

`fixtures/mockup.json` is the mockup dumped verbatim. It is the seed source and
the test oracle. It is **not** a data source for a component.

Read through [`lib/client.ts`](../lib/client.ts), always. If the data is not
there yet, that is a route the backend owes you, not a file to reach into.

This is the one shortcut no guard catches. A JSON import is not a `fetch`, so
nothing goes red. It is held by this line and by review.

### Routes are backend, components are frontend

Every route in this repo needs a matching `bk` command or the build fails
([`lib/cli-parity.test.ts`](../lib/cli-parity.test.ts)). If you need an endpoint,
ask rather than adding one.

## 4. The data model you render against

```
workspace      one account's container       in the URL as [ws]
   └── entity        one book, any number    ?entity=blackcode
        └── exercice     one fiscal year
             └── entry        one écriture
                  └── entry_line
```

**A workspace is not a book.** The user creates books and may have any number, so
a workspace cannot be one. This is decision D1 in the plan, and the mockup agrees:
it switches books with `?entity=`, a filter, on the same screens.

### The word "workspace" must never appear in the UI

It is platform tenancy. It names nothing in this product. The mockup has no team,
no members page, no sharing, and not one human-identity field across its 27 data
structures. There is one user, many books, and a fiduciary who receives an export
rather than a login.

So: no workspace switcher, no create-workspace flow, no members page until
somebody asks for one. `[ws]` stays in the URL because the platform's route
factories require it. Never explain it to the reader.

`apps/sales` settled the same point: its team page says "your team" and the word
workspace appears nowhere on it.

## 5. The surface is read-mostly, and that is checked

Thirteen screens, four writes: resolve an entry, create a rule, post a staged
entry, approve a compliance rule. Everything else reads.

```
lib/client.ts     the ONLY fetch(). Transport, consults nothing.
lib/mutations.ts  the ONLY module that sends apiSend. One gated primitive.
components/**     call the hooks. No fetch, no apiSend, no method strings.
```

[`lib/read-only.test.ts`](../lib/read-only.test.ts) asserts that arrangement, so
"can a component write?" is answered by three assertions instead of an audit. Put
a `fetch(` in a component and it goes red. That has been verified by doing it.

**The gate is not a security control.** `useCanWrite()` is client-side and the
user owns the client. Authorisation is workspace membership and the role, on the
server. What the gate buys is that a missed affordance fails loudly instead of
writing.

The four write hooks in [`lib/mutations.ts`](../lib/mutations.ts) are written and
commented out. They arrive with the tables they act on. They are not stubbed,
because a stub that returns success is a lie a component builds on.

## 6. What phase 0 gave you to build with

| Module | What |
|---|---|
| [`lib/types.ts`](../lib/types.ts) | the wire shapes. Money is a **string**, dates are ISO strings |
| [`lib/format.ts`](../lib/format.ts) | `money`, `group`, `date`, `percent`, `amount` |
| [`lib/statements.ts`](../lib/statements.ts) | art. 959a and 959b line structures, in legal order |
| [`lib/vocabularies.ts`](../lib/vocabularies.ts) | the seven vocabularies, with colours |

Three things about these that will bite otherwise:

- **Money crosses the wire as a string** and stays one. `numeric(14,2)` does not
  fit a float, and a bilan balances to the rappen. `amount()` exists for view
  arithmetic only, never for display.
- **`format.ts` uses an ASCII apostrophe** for grouping, not sales' U+2019, and
  keeps two decimals where sales rounds to whole francs. Both are deliberate: the
  phase 1 acceptance test compares output string for string against the mockup.
  Do not "fix" either.
- **Vocabulary colours travel with the value.** Never hardcode one, and never
  spell a vocabulary into prose. Both go stale the day a value is added, with
  nothing to say so.

**Zero-balance legal lines still exist.** They may be collapsed visually. They
are never absent from the model.

**Three figures will not match the static mockup, on purpose.** blackcode has
two entries dated 2025, and the API keeps them in a closed exercice 2025 while
the mockup summed both years into one statement. The 2026 bilan totals are
identical to the rappen, but résultat de l'exercice, résultat reporté and the
CR's autres charges each differ by the 2025 result (4850.00). If you are
comparing a screen against the mockup and one of those three is off by exactly
that amount, the API is right. The full reasoning is in
[`lib/db/seed.ts`](../lib/db/seed.ts), and `lib/db/seed-parity.test.ts` pins it.

## 7. What was missing, and what the frontend chose — settled 2026-08-17

> **This section described an absence. The absence was filled on 2026-08-17 by
> the frontend's sprint 1, so it now records the DECISION instead.** The original
> wording ("there is no TanStack Query and no provider… also absent: any shell,
> nav, or theme wiring") was correct when written and is not any more.

The dependency set was left to the frontend rather than guessed, and the frontend
took the stack the root [`docs/frontend.md`](../../../docs/frontend.md) already
makes the platform convention, copied from
[`apps/sales/app/providers.tsx`](../../sales/app/providers.tsx):

- `@tanstack/react-query`, `next-themes`, `sonner`, `lucide-react` — plus
  `clsx`, `tailwind-merge` and `tw-animate-css`, at the versions `apps/sales`
  pins.
- `app/providers.tsx` in the order that file's header specifies:
  `SessionProvider → QueryClientProvider → ThemeProvider → ConfirmProvider`.
- `app/globals.css` is now this app's own palette: **ledger gold `#e8b84b`**,
  cream neutrals, `--radius: 0.5rem`. Token *names* are unchanged, so the
  `@blackcode/platform-ui` primitives keep working.

Two things a backend reader should know because they touch this file's contract:

- **`lib/query-keys.ts` is new and every read goes through it.** Almost every
  read in this app is scoped by `(entity, exercice)`, so the key shape is
  `['books', resource, { entity, exercice, …filters }]`, spelled in one module
  and enforced by `lib/query-keys.test.ts`, which scans for a `queryKey:` written
  any other way.
- **`lib/read-only.test.ts` now permits a SECOND write module**, `lib/account.ts`
  — for `POST /api/auth/register` and `PATCH /api/me`, neither of which touches
  `books.*`. `lib/mutations.ts` is still the only module that writes to the
  books, and the four writes are still four. The reasoning is in both files'
  headers.

**One correction this section owes you:** §2's table and `lib/types.ts` both
declare `entities` as an `Entity[]`. `app/api/meta/route.ts` actually serves
`entities: { source, note, data }` — the envelope that carries
`source: "fixture" | "database"`, which is the field the whole phase-0 contract
turns on. The route is right and `BooksMeta` in `lib/types.ts` is stale. The
frontend types against the wire shape (`MetaPayload` in `lib/hooks.ts`) and is
not going to edit `lib/types.ts`.

## 8. The thirteen screens, and when each gets real data

| Screen | Live at |
|---|---|
| Vue d'ensemble, Grand Livre, Transaction, Bilan, Compte de résultat | phase 1 |
| Reconnaissance | phase 2 |
| Comptes & sources, Source detail, Pièces justificatives | phase 3 |
| Compta analytique, Analyses, Analyse detail, Impôts | phase 4 |

Every layout is buildable now, against `/api/meta` and the shapes above.

**Do not build in phase order.** Compta analytique is the flagship and the longest
job in the project, and it lands last because it depends on everything. Its shapes
exist today, so build it early against fixtures and phase 4 becomes a data swap.
Build in phase order and you idle between phases.

A workable order: shell and vocabulary chrome, then analytique, then the five
phase 1 screens as they come live, then sources and pièces.

## 9. Language

**English chrome.** French only where the law fixes the wording: the bilan and
compte de résultat line labels, which the filed PDF has to reproduce. Those
arrive from `lib/statements.ts` and from the API, already in French. Never
translate them and never write French UI copy around them.

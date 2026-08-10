# b/sales — frontend

**This app only.** Platform-wide conventions — the tokens, the
`@blackcode/platform-ui` primitives, the app shell pattern, data fetching — live
in the root [`docs/frontend.md`](../../../docs/frontend.md) and are not repeated
here. An app's docs never describe another app
(`docs/platform-architecture.md` §7.5).

Status: **Phases 6–9 landed 2026-08-07.** The providers, the shell, the two
dashboard empties, every page group, ⌘K, Activity, the full search page,
Settings, and the read-only / full switch with its write affordances.

**Super-admin is NOT built, and never will be** — platform administration lives
in one app and it is not this one (§11, settled 2026-08-07).

---

## 1. The four rules this surface is shaped by

Inherited from the validated mockup (`docs/sales-app-plan.md` §1.2). They are the
product, not the styling, and every one of them is a thing this app must *not*
do:

1. **A ledger, not a control surface.** No chat box, no approve button, no AI
   running in the page. Everything shown is a record of something that already
   happened, written by an agent through `bk sales`. The mockup shipped an
   approval UI on the Today page twice by accident and removed it twice — the
   two screenshots `bs-today.png` and `bs-today-no-approvals.png` are the record
   of it, and **the second is the one to build from.**
2. **Triangulation is why it exists.** Client × Product × Message. The prospect
   page displays the STORED result of matching; the matching runs in the agent,
   never here.
3. **Multi-channel is first class.** A prospect shows "3 emails, 2 WhatsApp,
   1 call" at a glance — communications are not an email log with extras.
4. **Meetings are a ledger, not a calendar.** No month grid, no drag to
   reschedule.

## 2. Visual identity

The palette, the radius and the chart series are tokens in `app/globals.css` and
are documented in [`backend.md` §5](./backend.md) beside the reasoning for the
warm neutrals. Two things belong here instead, because tokens cannot carry them:

- **Density is a component convention.** D-4 gives sales an `h-12` header and
  `py-2`/`py-3` rows against issues' `h-11` and tight ones. There is no token for
  spacing, so the header height in `components/sales-shell.tsx` and the row
  padding in each listing are what make it true.
- **Never hardcode a colour in a component.** Chrome comes from the token
  utilities; **vocabulary colours come from `lib/pipeline.ts` and nowhere else.**

### 2.1 `components/chips.tsx` is the only bridge between the two

Every stage, channel, meeting-type, objection, product, template, document and
next-action badge is the same `Chip` with a different lookup, and each lookup is
one of `lib/pipeline.ts`'s `…Color()` helpers. A component that wanted to name a
hex would have to come through here to do it.

The hex reaches the DOM as an inline `style`, which is deliberate rather than a
shortcut around Tailwind: these are **data** values. The vocabulary is served
live by `bk meta` and can gain a stage without a deploy, so a utility class per
value would be a class that has to exist before the value does — and Tailwind
cannot generate `bg-[#e08658]` for a string it has never seen. The fill is the
colour at low alpha with the colour itself as text, so one hex drives both and
the chip stays legible in either theme without a second value being picked for
dark mode.

> **Nothing in the repo catches a violation of this rule.** Verified on
> 2026-08-07 by hardcoding a stage colour in `chips.tsx`: `npm run typecheck`,
> `npm run lint`, `npm test` and `npm run build` all stayed green, and eslint did
> not even flag the now-unused `stageColor` import. It is a convention held by
> this document and by code review, not by a guard.

## 3. The shape of a page

Thin server page → one `'use client'` feature component → TanStack Query.

```
app/dashboard/[ws]/page.tsx          server: awaits params, renders <TodayPage ws={ws} />
components/today/today-page.tsx      client: the whole page, fetching through hooks
lib/hooks.ts                         the query hooks
lib/client.ts                        apiGet, wsPath, query — the only fetch layer
```

Nothing is fetched on the server. A server-rendered first paint would need a
second copy of the data access, and the two would then have to agree about
caching, errors and empty states.

### 3.1 `lib/client.ts` — same-origin, and one fetch

Every fetch is a **path**, never an absolute URL and never an env var pointing at
another deployment (D-10). That is what makes the shared route factories (D-2)
mandatory rather than nice: this app serves its own `/api/upload` and `/api/meta`
because a fetch is not allowed to go and find somebody else's. There is no
exception left: the one that used to exist — cross-app link anchors carrying an
absolute `url` the server built from another app's `base_url` (D-18) — went with
the shared link index in Phase 3.

It exports **two** request functions and **one `fetch(`**. `apiGet`, and — since
Phase 9 — `apiSend`, which is every non-GET request the app makes.

That is still a property of the module graph rather than of anybody's intent, and
§8.3 is how it stays one: `apiSend` is TRANSPORT and consults nothing, the gate
is `lib/mutations.ts` one layer up, and `lib/read-only.test.ts` asserts the
arrangement instead of trusting it. The check that used to be "there is no write
verb" is now "there is exactly one `fetch(`, and only one module sends it at an
`/api/workspaces/…` path".

Errors carry the server's `{ error, code, suggestion }` through to the browser —
the same body `bk` prints as a `hint:` line. A 400 an agent could act on should
be one a human can act on too.

### 3.2 Wire types are imported, never retyped

`lib/hooks.ts` uses `import type` from `lib/db/queries/aggregates.ts` and
`lib/views.ts`. The imports are erased at compile time, so no server module and
no drizzle client reaches the browser bundle — what survives is that a change to
`TodayResult` becomes a type error in the page that reads it.

### 3.3 Three states, one implementation

`components/states.tsx` — `BlockSkeleton`, `ErrorState`, `EmptyState`. A failed
fetch renders the error, never the empty state: rendering "you have no prospects"
when the API is down is the most reassuring wrong answer this app could give.

## 4. The shell

`components/sales-shell.tsx`. Fixed left rail, sticky `h-12` header, content
right.

- Nav: Today · Metrics · Prospects · Meetings · Communications · Activity, then
  **Catalog**: Products · Templates · Documents, then Trash.
- **No workspace switcher and no create-workspace flow** (D-3). `/dashboard`
  resolves the single sales workspace and redirects to `/dashboard/{ws}`; more
  than one renders a picker rather than guessing, because landing somebody in the
  wrong workspace is a silent failure.
- Header title defaults to the nav label for the page and is overridable with
  `usePageTitle()` — a prospect detail page's title is a company name and no
  static table can hold it.
- Account footer: name, email, **Settings**, sign out. The Settings link went in
  with the pages, which is the rule that kept it out; it points OUTSIDE the
  workspace segment, at `/dashboard/settings/*`, because three of its four pages
  are about the blackcode account rather than about this workspace.

## 5. The empty, and the one that was deleted

`app/dashboard/layout.tsx`.

Until 2026-08-10 there were **two** empties and the whole point of the section was
telling them apart: *"No workspace yet"* versus *"No access to b/sales"*, the
second coming from `listMyWorkspaces({ app })` filtering `platform.workspaces`
through `platform.app_access`. Collapsing them would have shown a
member-without-access an onboarding screen that quietly *worked* while hiding the
real problem.

**That distinction is now unrepresentable, and the branch is gone.** This app
owns `sales.workspaces`; a member of a sales workspace is a sales user, full
stop. There is no second app inside one of its workspaces to be switched off, so
there is no second empty to describe — and a screen nobody can ever reach reads
to the next person as protection. `PLATFORM_ENFORCE_APP_ACCESS` is not consulted
anywhere in this app any more.

| | Condition | What it says |
|---|---|---|
| **No workspace** | `listWorkspacesForUser(user)` is empty | *"No workspace yet."* One is created the moment you sign in, so this means that step did not finish. Sign out and back in — it retries |

**Its meaning changed with its neighbour.** Every sign-in mints a workspace
(`lib/auth.ts` → `ensureWorkspaceForUser`, one transaction), so this is an
ANOMALY screen now rather than the normal state of an internal product nobody
self-serves into. That is why the wording names the action that actually retries
it, instead of naming somebody to ask.

## 6. Auth, and the one thing that fails silently

`lib/auth.ts` is this app's NextAuth config. What is app-local (providers,
`pages`) and what is shared (the session cookie, the sign-in callbacks in
`platform-db`) is argued in full in `packages/platform-auth/src/index.ts`; it is
not repeated here. Two things are this app's own:

- **A first sign-in does not create a workspace.** Issues calls
  `ensureDefaultWorkspace`; sales does not, because D-3 leaves no way to see or
  leave a workspace minted that way, and it would arrive with `sales` not enabled
  on it. Pending invitations *are* still materialised.
- **`middleware.ts` must pass `cookies` to `withAuth`.** `getToken` looks for
  `next-auth.session-token` unless told otherwise, and D-16 renamed the platform's
  session cookie to `blackcode.session-token`. Omitting it does not error: the
  user signs in successfully and bounces back to `/login` forever, 200 on every
  request, nothing in the logs. Import `sessionCookieConfig` from the
  **`/session-cookie` subpath** — the package barrel pulls node `crypto` into the
  Edge runtime.

## 7. The pages

| Path | What it is |
|---|---|
| `/dashboard/{ws}` | **Today** — §7.1 |
| `/dashboard/{ws}/metrics` | pipeline funnel + performance KPIs — §7.2 |
| `/dashboard/{ws}/prospects` | table ⇄ board, filter bar in the URL |
| `/dashboard/{ws}/prospects/{n}` | four tabs, journey, contacts, objections, triangulation |
| `/dashboard/{ws}/meetings` · `/communications` | the two cross-prospect ledgers |
| `/dashboard/{ws}/products` · `/templates` · `/documents` | the catalog |
| `/dashboard/{ws}/activity` | what changed and who changed it — §7.7 |
| `/dashboard/{ws}/search` | grouped, faceted full search — §7.8 |
| `/dashboard/{ws}/trash` | the bin, read-only in both modes |
| `/dashboard/settings/{profile,members,account,tokens,preferences}` | §9 |
| `/invitations/{token}` | where an invitation link lands — accept or decline |

Three conventions they all share, each of which is a decision:

- **List state lives in the URL**, not in component state: `?view=board`,
  `?stage=won`, `?tab=communications`, `?focus=12`. A filtered view is something
  somebody sends to a colleague, and it survives a reload without a store.
- **`?focus=<n>` highlights and scrolls to a row** rather than opening a page.
  Meetings, communications, products and templates have no detail page and need
  none — the row IS the record — and that is what ⌘K and the triangulation block
  navigate with.
- **Vocabulary values are never rendered raw.** `check_in` is a wire value;
  "Check-in" is what a human reads, and `lib/pipeline.ts` owns the mapping. This
  was got wrong once on the prospects table and caught in the browser.

### 7.1 Today

`components/today/today-page.tsx`. Four blocks: the greeting, the KPI strip,
**upcoming meetings across every prospect as their own block**, and the pipeline
queue.

- The greeting's date comes from `today.date` — the day the *server* computed
  for — not from the browser clock.
- The queue includes **overdue** actions, flagged. Past the due date the stored
  `due_label` is replaced by the computed phrase: the label is a snapshot of how
  the date read when it was written, so an action written last week says "Today"
  forever. Seen on the seeded database, five times.
- `today.due_actions` carries no deal value, so the queue joins against the
  `/prospects` list route it would load for the Prospects page anyway, and
  TanStack shares the cache entry.
- **`GET …/meetings` orders `starts_at DESC`**, which is right for a ledger and
  wrong for "what is next": a small limit returns the furthest-out meetings. The
  hook asks for a full page and sorts ascending, and renders a line saying so
  when there are more than it could load rather than showing a quietly short
  list.

### 7.2 Metrics, and the chart-kit decision (D-12)

**`KpiCard` from `@blackcode/platform-ui/charts` is used.** It accepts
`value: number | string`, so passing an already-formatted Swiss string bypasses
its internal formatter and it renders this app's numbers correctly with no change
to the package.

**The stage funnel is built in `apps/sales/components/`, for a specific reason
rather than taste.** The kit's `HorizontalBars` applies its own `formatNumber` to
every value, and that function is `Intl.NumberFormat('en-US')` with compact
notation above 10,000 — so `105000` renders as **`105K`**. The funnel's entire
content is CHF amounts and `CHF 105’000` is the exact figure the stakeholder
validated; a compacted, US-grouped number is wrong twice. `HorizontalBars`
exposes no formatter prop.

**No formatter prop was added to the shared component either.** Widening shared
code to fit one app's rendering is how a two-app package becomes a four-app
liability, and D-31 settles it the other way round: the app builds its own. The
local bar is about twenty lines and reads `lib/pipeline.ts` for its colours,
which a shared one would have had to be told anyway.

### 7.3 Prospects, and the two things the mockup insisted on

- **A normal full-width table.** No inner scrollbox, no fixed-height container
  (`UPDATE-7.md` item 4): the page scrolls. A listing inside its own scroll
  region hides its own length and breaks find-in-page. The board is the one
  horizontal exception, because six stage columns do not fit a laptop.
- **Every stage gets a board column and a funnel row, including the empty
  ones**, in pipeline order — the same rule the server applies. A board that
  omits the stage nobody is in hides the thing worth noticing.

There is **no drag-and-drop** on the board. Moving a deal is a mutation (D-7),
and a draggable board also needs a `PATCH …/reorder` — the one route class
`apps/issues` had to exclude from CLI parity as meaningless outside a UI. Stage
changes go through `bk sales prospect stage`, which records who moved it and why.

### 7.4 Prospect detail

Tabbed, not one long scroll (`INSTRUCTIONS.md` UPDATE 3): a prospect accumulates
dozens of exchanges and three or four stage changes, so on one page the
communications log wins by length and the shape of the deal disappears under it.

- The **journey** renders the whole ladder including the stages not reached yet —
  `upcoming` rows are placeholders with no date and no actor, and that is what
  makes it a journey rather than a history.
- **Objections keep their three fields as three.** What they SAID, what we think
  they MEAN, and what we say back is the only structured sales insight in the
  product; `lib/views.ts` refuses to collapse them and this page must not either.
- **Triangulation DISPLAYS a stored result** (§1.2 rule 2). `computed_by` says
  who decided. Nothing here ranks, scores or recomputes — a component that began
  sorting products by fit in the browser would be the one thing the doctrine
  forbids, and it would look like a feature.
- **Related is GONE (2026-08-10, Phase 3).** It rendered `platform.links`, the
  shared cross-app index this app no longer writes or reads. A panel that could
  only ever be empty, telling the reader to run a command that now 404s from this
  deployment, is worse than the absence — it advertises a capability. D-18's
  requirement stands: a relationship has to be visible, and what carries it now
  is the far end's URN in the prospect's own summary or a note, which is this
  app's data rendered by this app.
- The **Documents / Meetings / Communications tabs call the same routes as the
  standalone pages** with `?prospect=<n>`. That is what makes them filtered views
  rather than parallel stores (D-8).

### 7.5 Trash

Read-only, like everything else, and this is the page where that matters most:
`bk sales trash purge` is irreversible, and `Confirm()` auto-approves under
`BK_NO_PROMPT=1` and on a non-TTY. A web button with none of the CLI's
repeat-the-target-back protection would be the weakest path to the most
destructive verb in the app. It shows the `type:number` ref to paste into
`bk sales trash restore`, and the purge date as well as the delete date —
retention is the real data-protection control (D-19 item 1), so the page shows
when a row goes, not only when it arrived.

### 7.6 ⌘K

`components/command-palette.tsx`, calling `…/sales-search` — the **app-owned**
half of D-9, which reaches inside call summaries, meeting outcomes and template
bodies. The platform half (`…/search`, over `platform.entities`, every app) is a
different path and this app does not mount it.

It **navigates and does not act**: there are no commands in this command palette,
even in `full` mode. A palette that could create things is a control surface, and
§1.2 rule 1 is that this app is not one — the write affordances live beside the
records they change, where the reader can see what they are editing.

**⌘K and the search page go through ONE hook**, `useSalesSearch` in `lib/hooks.ts`,
and neither component names the endpoint. That is the property, not tidiness: two
call sites can rank, paginate and fail differently for the same term with nothing
to say which is right. `lib/search-parity.test.ts` asserts it, and asserts that
this app does not mount the platform `…/search` route beside its own.

The hand-rolled sequence counter that used to prevent a slow "ro" repainting over
a fast "roches" is gone: the term is part of the TanStack query key, so a resolved
request can only write into its own cache entry. A failed search still shows the
error rather than an empty list — an empty list on a failed request reads as
"nothing matches", which is the reassuring wrong answer.

The four types with no #number (contact, objection, match, stage entry) open
their parent prospect — they have no URN and no page, and returning nothing would
mean rendering a result nobody can click.

### 7.7 Activity

`components/activity/activity-page.tsx`, over the shared `activityRoute` this app
now mounts. Three things about it are decisions:

- **The feed is filtered to `app=sales`.** `platform.events` holds every app's
  rows for a workspace, and this page has no vocabulary, no colour and no URL for
  an `issue`. Reading ACROSS apps is `bk activity`'s job and it tags every row
  with the app it came from; a page that cannot show the tag must not show the
  rows. D-9's two layers, one level down.
- **The filter options are built from the feed, not from a list.** `?action=`
  DROPS an unrecognised value rather than rejecting it, so a stale option here
  would return the whole feed and look like it had worked — which is what issues'
  `app_*` actions did for months. They come from the UNFILTERED query, so
  choosing a filter cannot remove the option that would change it.
- **An unrecognised action renders its wire value with the underscores loosened,
  never nothing.** The vocabulary grows without a deploy, and a feed that hid
  what it did not recognise would quietly stop showing the newest thing that
  happened — the one row anybody came for.

The mount is NOT the three lines §8 of this file used to promise. `activityRoute`
is Class B (D-22): it takes a contribution, because an event's `entity_id` is an
internal serial and swapping it for the #number means reading `sales.*`. The
contribution's `numberedEntityTypes` is `ENTITY_TYPES` from `lib/entity-address.ts`
and its two vocabularies are the arrays `lib/db/queries/events.ts` derives its
unions from — three lists that cannot drift because there is one of each.

### 7.8 Search, and the facet that is not there

`components/search/search-page.tsx`. Grouped by type, filter state in the URL.

- **Type** is a real server facet (`?type=`). Its counts come from a second,
  unfiltered query — TanStack shares it with the "everything" view — because
  counts taken from the filtered list read `1` beside every type but the chosen
  one. The chips are built from the types actually RETURNED, so a tenth
  searchable type appears with a working filter on the day the route gains it.
- **Stage and owner** are derived, not searched. A hit carries neither: it is a
  row from one of nine tables and only some belong to a deal. The page joins each
  hit to its prospect through the `/prospects` listing it already loads — the
  same trick Today's queue uses for deal values — and says so when a deal facet
  hides catalog results, because a product disappearing without explanation reads
  as the search being broken.
- **There is no date filter.** `…/sales-search` returns no timestamp on any hit.
  The deal's `updated_at` is reachable through the join above, but "the deal was
  touched last week" is not "this meeting happened last week", and a control
  labelled by date answering a different question is worse than no control.
  Adding a date to the hit shape is a change to that route, and D-9 says to say
  so rather than to build a parallel endpoint.
- The page states which of D-9's two searches it is and names the other, because
  a reader who cannot tell them apart is the failure the decision prevents.

## 8. Read-only and full mode (D-7), and how to CHECK it

### 8.1 It is an affordance switch. It is not a permission.

`sales.user_preferences.ui_mode`, per person per workspace, default `read_only`.
`read_only` renders no editing. **The server never consults it** — not in a
route, not in a query, not anywhere. Authorisation is `platform.app_access` and
the workspace role.

Verified on the seeded database, 2026-08-07, in BOTH directions, because one
direction proves nothing:

| Set up | Result |
|---|---|
| `ui_mode = 'full'`, per-app access revoked | `PATCH …/prospects/1` → **403 `app_access_denied`**. The mode grants nothing |
| `ui_mode = 'read_only'`, access granted | the same request → **200**, and the change lands. The mode withholds nothing |

### 8.2 What `full` makes writable, and why not everything

    WRITABLE IN full:   prospect (name, value, city, sector, source, summary),
                        its stage, its next action, contacts, objections,
                        meetings, communications
    READ-ONLY IN BOTH:  products, templates, documents, matches, the journey
                        ladder, trash, activity

**The line is what a human can know that the agent cannot.** A person on a call
learns the deal moved, that a contact's email is wrong, what the meeting turned
into. Nobody independently learns the product catalogue changed — they tell the
agent, and the agent writes it. Editing the second list here would double this
app's surface for cases nobody has.

`components/forms.tsx` carries the two components that make the distinction
visible: `<WriteGate>` for a thing this app CAN edit but has hidden, and
`<AgentOnly>` for a thing it never edits. Two rather than one flag, because "you
have this switched off" and "nothing switches this on" are different facts, and
collapsing them is how somebody spends an afternoon looking for the setting that
would let them edit the catalogue. **Both always say something** — a control that
is simply absent reads as a feature that does not exist.

### 8.3 How a REVIEWER checks it, without reading every component

Agent6 left a property rather than an intention: one `apiGet`, one `fetch`, no
mutation verb in the app. `lib/read-only.test.ts` keeps it one:

    lib/client.ts     the ONE fetch(). apiGet + apiSend. Transport, consults
                      nothing.
    lib/mutations.ts  the ONE module sending apiSend at an /api/workspaces/…
                      path. Every hook composes `useRecordMutation`, the single
                      useMutation in the file, which reads useCanWrite().
    components/**     render useCanWrite() and call those hooks.

Four named account modules may call `apiSend` — profile, tokens, cli-authorize,
and the switch itself — and the workspace-path rule applies INSIDE them, so an
allowance cannot become permission to write records. None of them is behind
`ui_mode`, deliberately: a display preference that stopped somebody revoking a
leaked token would have become a permission over the account.

**What the file does not claim:** that every button is correctly hidden. It
claims every record write goes through one gated function, so a button that was
not hidden fails loudly instead of writing.

### 8.4 `lib/ui-mode.test.ts`, and the half D-7 did not ask for

The mandated guard is "no server module imports `ui-mode`", and it is walked as
an import GRAPH from every server entry point, stopping at each `'use client'`
boundary — a grep would catch the direct import and miss the realistic one, which
is a route reaching it through a helper.

**On its own it is not enough**, and that is a finding rather than a footnote. A
route can consult the mode without `ui-mode` appearing in its graph at all:

```ts
const prefs = await getPreferences(ctx.workspace.id, ctx.user.id)
if (prefs.ui_mode !== 'full') throw Errors.forbidden('read-only mode')
```

The value comes from the query layer, where it has to live. That regression was
injected into `PATCH …/prospects/{n}` and **the suite passed 4/4** with `ui_mode`
acting as a permission on a write route. So a second check confines
`lib/db/queries/preferences.ts` to the preferences route, with a named allowance
and a staleness check on it.

The VALUES (`UI_MODES`, `UI_MODE_DEFAULT`, `UI_MODE_FULL`) live in
`lib/pipeline.ts` with every other vocabulary, not in `ui-mode.ts`. The route
that validates a PATCH genuinely needs them, and a guard that forbids importing a
module containing something legitimate is a guard that gets weakened (D-37).
`lib/ui-mode.ts` holds React hooks and nothing else.

`useCanWrite()` asks `mode === UI_MODE_FULL`, not `!== UI_MODE_DEFAULT`. Identical
today; the moment a third mode exists, one defaults it to showing nothing and the
other to showing everything.

## 9. Settings

`/dashboard/settings/{profile,members,account,tokens,preferences}`, outside the
workspace segment because most of them are about the **blackcode account** rather
than about this workspace — and the pages say so, because a Settings screen inside
one app reads as that app's settings and this one is not.

**Members (2026-08-10) is the exception, and it is the screen the multi-app
refactor exists for.** It is about THIS app's workspace: `sales.workspace_members`
and `sales.invitations`. Before it, nobody could be put into b/sales from
b/sales — membership was `platform.workspace_members` plus a per-app grant, so a
sales user was somebody who had first been invited into an issues workspace.

It is **visible by default**, not behind a role check. An owner needs it to
invite; a member needs it to see who else is here. The page hides the invite form
from non-owners, which is where that decision belongs — a tab that appears for
some people and not others is how "why can Ana see this and I can't" becomes
unanswerable.

The word *workspace* does not appear on it. It says "your team", because a sales
user has exactly one and never picks it (PLAN.md §1). Roles are shown and not
editable: no app on this platform has a change-role route, and inventing one here
would have been a new platform capability landed inside a tenancy migration.

Inviting and removing go through `lib/mutations.ts` behind `useCanWrite()` —
they are sales RECORDS now. **Accepting an invitation does not**, and
`components/accept-invitation.tsx` has an entry in `lib/read-only.test.ts`
saying why: read-only is a browser display preference, and one that could stop
somebody joining the app at all would be a permission over their account (D-7).

Preferences is the exception: `ui_mode` is keyed on (user, workspace), so that
page resolves the workspaces this person can reach and renders one block each.
With one workspace (D-3) nobody notices; the plural branch exists so it is never
"pick the first and hope".

**Three things the account page does not do, and it names where each is done.**
Changing a password needs `passwordRequestOtpRoute`, whose second argument is an
email SENDER, and sales has none — mounting it would answer 200 to "we sent a
code to b•••@…" with nothing arriving, which is the invisible failure this
project keeps finding. Closing an account is irreversible and crosses every app,
so `app/api/me/route.ts` deliberately exports GET and PATCH and **not** DELETE.
And platform administration lives in one app (§11).

**The name and the link are DERIVED, never spelled.** The page's server half
calls `appsReachableByUser` and passes the apps this person can reach, with
their registered `base_url`s — the same mechanism D-18 uses for a cross-app link.
Hardcoding another app's slug here would be a second declaration of a fact that
lives in `platform.apps`, and it would be wrong the day a third app arrives. A
person who can reach only b/sales gets the same sentence with no link, which is
still the right answer: the control exists and it is not here.

The administration line is shown to **everybody**, not only to super admins.
`is_super_admin` says whether you have the surface; it does not say where the
surface is, and hiding the sentence from somebody who does not have it means the
one person who goes looking is the one person not told.

## 10. What the mount decisions were, in one place

| Platform route | Mounted here? | Why |
|---|---|---|
| `/api/me` GET, PATCH | yes | your profile, from this origin (D-10) |
| `/api/me` DELETE | **no** | irreversible, crosses every app, kept in one place |
| `/api/tokens`, `/api/tokens/{id}` | yes | `bk login` authorizes here, so revoking must work here |
| `/api/cli/authorize` | yes | D-21: Tier 1 for every deployed app |
| `/api/me/password/*` | **no** | needs an email sender this app does not have |
| `…/activity` | yes | the Activity page |
| `…/search` | **no** | D-9: the platform search is a different path, deliberately |
| `bk inbox`, `bk super-admin errors`, `bk storage list` | **no**, permanently | [`backend.md` §7.1](./backend.md) |

## 11. Super-admin: not built, and not coming

**`/dashboard/super-admin/{users,errors}`.** Deliberately absent.

The routes those pages need (`GET /api/super-admin/users`,
`/api/super-admin/errors`) are **not** shared factories. They live in
`apps/issues`' own tree over `platform.users` and `platform.error_events`, and an
app may not import from another app. Meanwhile [`backend.md` §7.1](./backend.md)
records `bk super-admin errors` as **permanently** unmounted here for a stated
reason — platform-wide data, any host answers — and D-28's test ("would two
deployments answer differently?") says no.

So building it here would mean a second copy of a platform-wide admin surface,
which is the tier mistake D-28 exists to prevent.

Three options were on the table:

| | Option | Outcome |
|---|---|---|
| a | promote the routes to `packages/platform-api` | defensible only under "every deployed app carries its own admin surface", which nobody has argued for and which multiplies one admin surface by N apps |
| b | duplicate the platform-wide admin queries into this app | the tier mistake D-28 exists to prevent |
| c | platform administration lives in ONE app; this one links to it | **chosen** |

> **Settled 2026-08-07: (c).** D-28's test decides it — *would two deployments
> answer differently?* No: `platform.users` and `platform.error_events` are the
> same rows from any host. `backend.md` §7.1 had already written that ruling down
> for the CLI half, listing `bk super-admin errors` as permanently unmounted here
> for exactly this reason, and building the web pages would have contradicted a
> decision this project already made in writing.
>
> The options are kept above rather than deleted so the next reader does not
> re-derive them — and so that anybody proposing (a) has to argue against the
> reason (a) lost, not against silence.

Nothing is half-built: there is no super-admin directory, no gate and no dead
link. What exists is one line on `/dashboard/settings/account` saying where
platform administration is, with a link built from the other app's registered
`base_url` — the same reasoning as the password and account-deletion lines
beside it. A control that is simply absent reads as a feature that does not
exist.

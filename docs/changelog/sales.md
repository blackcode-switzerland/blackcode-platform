# Changelog — sales app

Breaking and notable changes to the **sales** app: prospects and their contacts,
meetings, communications, objections, products, templates and documents. Newest
first. If a command that used to work now fails, check here first — and check
`platform.md` too, which carries changes to workspaces, members, files, tokens
and the `bk` CLI itself.

For how the CLI **works** (rather than what changed), run **`bk guide`** — the
complete usage guide, embedded in the binary, so it always describes the version
you are running. For live values (vocabularies, limits, your workspaces), run
**`bk meta`**.

Surfaced at: `GET /api/changelog` (JSON or `?format=markdown`) and `bk changelog`,
which merge every app's file into one feed by date, each entry tagged with its
app. `bk changelog --app sales` filters to this file.

> **Process rule:** every change to a route or user-facing feature must add a
> dated entry here. Timestamp it and describe what changed and how to adapt.
> A change touching shared platform data goes in `platform.md` instead, even
> when this app is what prompted it.

---

## 2026-08-11 — Settings → Members: editing is hidden in read-only mode, and every invitation link is copyable

Two things, both found by opening the page rather than by calling its routes.

**The Invite field and the Remove / Revoke buttons now respect `ui_mode`.** This
was the one screen in the app that rendered record-write controls without asking
— so in `read_only`, which is the DEFAULT, it showed a live-looking Invite field
and enabled buttons while every other surface said "Editing is hidden — this
browser is in read-only mode". Nothing was ever written and the refusal was loud
(the click raised an error toast naming both recoveries), which is exactly why it
survived: the safety net held and the affordance stayed wrong underneath it.

Nothing changes for `bk sales invite send|revoke` or `bk sales member remove`:
`ui_mode` is a display preference for one browser, never a permission.

**A pending invitation's link is on its row.** The section says "b/sales does not
send email — copy the link and send it yourself", and until now the link appeared
only in the banner shown immediately after inviting. After a reload it was
unrecoverable from the UI, even though the token was already in the row's
payload; the owner's options were to revoke and re-invite, or read the token out
of Postgres.

---

## 2026-08-11 — The members page was blank; both of its lists were reading the wrong shape

**Fixed. No action needed.** Settings → Members threw a client-side exception for
everyone, and the pending-invitations list below it silently rendered nothing.

Both list routes answer with the standard `{ data, next_cursor }` envelope. The
page asked for a bare array — once by annotating `apiGet<Member[]>`, once by
casting an envelope with `as unknown as`. TypeScript believed both. `members.data`
was then the envelope: truthy, so the "do we have data" guard passed, and `.map`
threw. The invitations list failed the quieter way — `.length` on an envelope is
`undefined`, so it rendered nothing and looked like an empty list.

**Nothing was wrong on the server**, which is why no route test caught it. Both
routes returned correct responses throughout.

## 2026-08-10 — the sales dashboard was 404ing for every sales-only account

**Fixed.** A brand-new sales sign-up — the account this app's Phase 2 exists to
create — got **404 on their own dashboard** at `/dashboard/<workspace>`, while
every API route for the same person worked normally.

The workspace frame resolved membership through `platform.workspaces`, the SHARED
table, filtered by the per-app access grants. Phase 2 moved this app's workspaces
to `sales.workspaces` and repointed the layout beside it; this file, one directory
down, was missed. Somebody with no *issues* workspace therefore matched nothing.

It reads `sales.workspaces` now. If you signed up for b/sales and the app appeared
to be empty or missing, that was this, and it is fixed.

*(Note for anyone reverting: dropping only the access filter would have been worse
than leaving the bug. The page would then have matched any PLATFORM workspace
sharing the slug, and migration 0004 mirrored ids and slugs deliberately — that is
a cross-tenant frame, not a fix.)*

---

## 2026-08-10 — every b/sales verb names the app: `bk sales workspace`, `bk sales member`, `bk sales invite`

**Breaking for anything scripted.** The bare `workspace`, `member` and `invite`
verbs answered from whichever app your CLI was homed on. Since this app got its
own workspaces and memberships earlier today, that answer was a coin flip. They
are spelled with the app now:

```bash
bk sales workspace list
bk sales workspace use <slug>
bk sales member list
bk sales invite send <email>
```

`bk sales workspace` has `list`, `show` and `use` and deliberately **no**
`create`, `edit`, `transfer` or `delete`: a workspace is the company, and you are
granted one rather than opening one from a sales context (D-3). Those are
answered by the issues deployment.

**This app's active workspace is its own.** `bk sales workspace use acme` does
not move `bk issues`, and vice versa. After upgrading, run it once — until you
do, `bk sales …` fails with an error naming this app and the fix.

`bk sales activity` replaces the bare `bk activity` and reads this app's own
event feed. `bk sales search` is unchanged: it was always this app's full-text
search over its own records, and it is now the only `search` this app has.

**There is no `bk sales inbox`, `bk sales storage` or `bk sales user`.** This
deployment serves no route for any of them, and a command that could only 404 is
a dead end with a help page. `bk sales member list` is who is in your workspace.
`GET /api/users` was removed from this deployment in the same change: it answered
out of the platform membership table, so it listed people who are in no sales
workspace at all.

Run `bk sales --help` for this app's full surface, or `bk guide platform/apps`
for why the app is in the command.

## 2026-08-10 — b/sales stops sharing the database: `bk search` and `bk link` are gone from this app

**Breaking, for anything scripted against a sales-homed CLI.** This app's
records — labels, uploaded files, activity — moved out of the shared
`platform.*` tables into its own. What you can do with them here is unchanged;
what changed is what the CROSS-APP commands answer when you ask this deployment.

**What breaks**

| Command, homed on sales | Now | Do instead |
|---|---|---|
| `bk search <q>` | exit 5, "the sales app does not serve …", with a hint | `bk sales search <q>` for this app's records — it searches full text, which the shared index never held. For another app's, `--app-server <slug>` |
| `bk link create \| list \| rm` | exit 5, same shape | **This is going away entirely.** Put the far end's URN in the record's own text: `bk sales prospect edit 12 --summary "Blocked on bc:issues:acme/issue/512"` |
| `bk activity` | **this app's feed**, not every app's | Nothing — each entry still carries `app`, and `--subject <urn>` still gives one record's whole history |
| `bk storage list` (from any host) | no longer lists this app's files | An app's own files are listed by that app. This app's ledger is its own now |

Failures are loud, never empty: a 404 with a `hint:` line naming
`--app-server`, `bk app use` and `bk app list`, and exit 5. An empty result page
would have read like "no matches".

**What does not change**

- Every `bk sales …` command, unchanged.
- **URNs.** `bc:sales:<ws>/prospect/12` is still printed by `prospect show`,
  still carried as `subject_urn` on activity entries, and still resolves — it is
  built from this app's own workspace and #number, so it never depended on the
  shared index.
- Labels: same commands, same output shape. `app` is still a field on a label
  and still says `sales`.
- Uploads: same route, same limits, same store. A file uploaded here is now
  attributed to your SALES workspace rather than to whichever workspace you last
  selected in another app — which is a fix, and may change the folder a new file
  lands in.
- Your data. Nothing of this app's was deleted except rows in the shared tables
  that this app had written and no longer reads.

**Why**: two apps sharing one index meant one app's search could return the
other's titles for a workspace id that means different people in each. Cross-app
search returns later as a client-side fan-out — the binary asking each app's
server and merging the answers — which needs no shared table.

## 2026-08-10 — b/sales has its own workspaces, its own members, and self sign-up

**b/sales no longer borrows another app's tenancy.** Until today a sales user was
somebody who had first been invited into an ISSUES workspace and then granted the
sales app inside it. Workspaces, membership and invitations now live in
`sales.*`, and a person can sign up, get a workspace, and invite a colleague
without the issues app existing.

**What is new**

- `POST /api/auth/register` — self sign-up. It carries the same whitelist gate
  the rest of the platform uses (`SUPER_ADMINS` + the approved-address list): the
  account it creates is the SHARED blackcode account, so an ungated sign-up here
  would be an ungated sign-up everywhere. A non-approved address gets `403
  not_in_whitelist`, before any lookup, so it cannot be used to probe whether
  somebody has an account.
- A workspace is created on your first sign-in, with you as its owner, in one
  transaction. You are never sent away to be invited somewhere else.
- `POST /api/invitations/accept` and `POST /api/invitations/decline` — so
  `bk invite accept <token>` works against a sales-homed CLI. **They did not
  exist here before**: an invitation created from sales could not be accepted
  from sales, and the accept link it printed pointed at a page this app did not
  serve. Both are fixed.
- **Settings → Members** — see your team, invite by email, remove somebody.

**What changed for a client**

- `bk workspace list`, `bk workspace show`, `bk member list`, `bk invite …` and
  `bk meta` against the sales deployment now answer about SALES workspaces. If
  you were relying on a sales-homed `bk` to show you an issues workspace, use
  `--app-server issues` or `bk app use issues`.
- `bk workspace use <slug>` against sales no longer changes the workspace the
  ISSUES deployment defaults to. They were one setting and are now two, which is
  the fix: one numeric id could not mean two different teams.
- `bk meta`'s `active_workspace` is your sales workspace, resolved from this
  app's own tenancy rather than from a shared column.
- Invitations still report `email_sent: false` — this deployment sends no email.
  The response now carries `accept_url`, which is the link to hand over.
- Roles are shown and not editable; no app has a change-role route yet.

**Removed**

- The "No access to b/sales" screen, and the per-app access check behind it.
  **A member of a sales workspace is a sales user.** `GET|PATCH
  /api/workspaces/{ws}/apps…` are gone from this deployment; per-workspace app
  switching is an issues concept and does not apply to a workspace only sales
  can see.

**Not changed:** `apps/issues` — not one row of its data moved, and its
workspaces, members, invitations and per-app access behave exactly as before.

---

## 2026-08-07 — `bk sales trash purge` destroyed communications without saying which

`bk sales trash purge communication:17` printed

```
destroyed communication:17
permanently deleted 1 item(s)
```

— the title blank. A purge is irreversible and its output is the only record of
what was in the row, so for communications it was a count and nothing more. The
recoverable command was better off: `bk sales comm rm 17` printed "note · out".

The cause was two spellings of "what is this row called". `listTrash` asks in
SQL and handles a null subject (`coalesce(subject, channel || ' · ' || direction)`);
the purge and restore paths read `.returning()` rows in JS and inlined
`row.name ?? row.title ?? row.subject ?? ''`, which has no such branch. Every
other binnable type has a `name` or a `title`, so only communications — the one
type whose title is derived — hit it.

Both paths now call `trashTitleOf`, which sits next to `titleColumn` so the pair
stays visible. `bk sales trash restore` was fixed with it, same cause.

**No action needed.** Nothing was destroyed that should not have been; the
report was incomplete, not the delete.

## 2026-08-07 — Cross-app links into sales pointed at pages that do not exist

**Breaking for anything holding a stored sales URL.** `platform.entities.url` is
written once, at write time, and five of the six sales entity types were storing
an address this app has never served.

Only a prospect has a detail page. Meetings, communications, products, templates
and documents are shown as rows in their listing, reached with `?focus=<n>` —
but the projection wrote `/dashboard/{ws}/{type}s/{n}`. So a `bk link` from an
issue into a sales meeting, a `bk search` hit for a document, and the Related
block on a prospect page all resolved to a 404. Only prospects worked, which is
the one type anyone had clicked.

**What changed**

- The address map exists once now, in `apps/sales/lib/dashboard-paths.ts`. A
  non-prospect type resolves to `/dashboard/{ws}/{listing}?focus=<n>`.
- The documents listing now honours `?focus=` — it was the one listing that
  ignored it, so even the corrected link landed on an unhighlighted list.

**What you must do.** Nothing, if your links are freshly created. If you hold a
sales URL read out of `platform.entities` before today, re-read it: the row has
not been rewritten in any database but the one whoever ran the repair touched.
Maintainers with `DATABASE_URL` repair a deployment with:

```
SALES_REPROJECT=1 npm run db:reproject --workspace=sales -- --dry-run   # report
SALES_REPROJECT=1 npm run db:reproject --workspace=sales                # repair
```

**`bk super-admin entity-drift` will NOT find this, and did not.** That command
is answered by the issues deployment and can only re-derive `issues.*` — an
app's Postgres role has no grant on another app's schema, so the cross-app
version of that query cannot be written. It reported no drift, exit 0, against a
database with fifty-one unprojected sales rows. Its help text has been corrected
to say which app it answers for; see `platform.md`.

## 2026-08-07 — The web app can write, and read-only is not a permission

**Read this paragraph before anything else, because the feature's name invites
the wrong reading.** b/sales now has a mode switch at **Settings →
Preferences**. `read_only`, which is the default, hides editing controls in the
browser. **It is not a permission.** The server never consults it: what you may
do is decided by your access to this app and your role in the workspace, and it
refuses a write the interface allowed exactly as readily as one it did not.
Anyone who can open b/sales can write through `bk sales` in either mode. If
somebody must genuinely be unable to write, that is a role, not a toggle.

Verified on a live database rather than asserted, both directions: with
`ui_mode = 'full'` and per-app access revoked, `PATCH …/prospects/1` answers
**403 `app_access_denied`**; with `ui_mode = 'read_only'` and access granted, the
same request answers **200** and the change lands.

**What a human can now do in the browser**, once they switch to full mode:

- edit a prospect — name, deal value, city, sector, source, summary
- move a deal to another stage, with the note that goes on the journey step
- set or change the next action, its date, the words it was said in, and its note
- add, edit and remove contacts
- record an objection, write the counter, move it to resolved, remove it
- record and edit meetings, including the outcome
- log an exchange on any channel, and bin one

**What stays agent-written in both modes**, and now says so on screen with the
command that does it: products, templates, the document library, the
triangulation matches, the journey ladder, cross-app links, and the recycle bin.
The line is what a person can know that an agent cannot — nobody independently
learns the product catalogue changed, they tell the agent.

Deleting from the web asks for the same string the route requires: a prospect's
company name, a meeting's title, the prospect name on a communication, an
objection's type. That check is enforced on the server, so the browser cannot
skip it.

**Not breaking.** No route changed shape, no command changed, and an agent that
never opens a browser is unaffected.

### New: your own display preferences

`GET | PATCH /api/workspaces/{ws}/preferences` — `bk sales preferences show`
and `bk sales preferences set --ui-mode <value>`. Run `bk meta` for the values.
The setting is per person, per workspace, and defaults to read-only. It affects
the web app only.

---

## 2026-08-07 — Activity, Settings, full search, and `bk login` against this host

**Activity.** `/dashboard/{ws}/activity` shows what changed and who changed it,
filtered to this app — b/sales now serves `GET /api/workspaces/{ws}/activity`,
which it did not before, so `bk activity --app sales --ws <slug>` answers from
the sales host as well. The feed is `platform.events`; there is no second
history. Reading ACROSS apps in one timeline is still `bk activity` without the
filter, which tags every row with the app it came from.

**Search.** `/dashboard/{ws}/search?q=` — the full page behind ⌘K. Results are
grouped by type with counts, and can be narrowed by type, by deal stage and by
deal owner. Every filter is in the URL, so a search is something you can send to
a colleague. It searches **inside** records — a phrase in a call summary, a name
in an attendee list — and the page says so, because `bk search` is the other
thing: it spans every blackcode app and returns URNs. No date filter: the search
route returns no timestamp on a hit, and a control labelled by date that
answered a different question would be worse than none.

**Settings**, at `/dashboard/settings/*`: your profile, your account, your API
tokens, and the mode switch above. Three of the four are your **blackcode**
account rather than a b/sales one — a name changed here is the name every app
shows, a token minted here works against every app you can reach, and signing
out signs you out everywhere.

Two things the account page deliberately does not do, and names where they are
done instead: **changing your password** (b/sales sends no email, so it cannot
deliver the one-time code; a button that reported success while nothing arrived
would be worse than no button) and **closing your account** (irreversible, and
it reaches every app — it stays in one place, behind a typed confirmation).

**`bk login --server https://sales.blackcode.ch`** now works. The sales host
serves `/cli/authorize` and `POST /api/cli/authorize`; before today the command
opened a 404 and the terminal waited for a callback that never came. The token
it mints is the ordinary platform-wide `bk_live_…` credential — authorizing
through b/sales does not produce a sales-only token.

### Fixed: a wrong `--confirm` destroyed the objection it refused to destroy

`bk sales objection rm` and `DELETE …/objections/{oid}` deleted the row and
*then* compared `--confirm` against what came back. Naming the wrong type
returned a 409 explaining the mismatch — with the objection already permanently
gone. Objections have no recycle bin, so this was the one operation in the app
where a wrong guess could not be undone.

The check now runs before anything is destroyed, and again inside the delete's
own transaction. **If you have scripted around this**, note the behaviour
change: a mismatched `--confirm` now leaves the objection in place. The response
is the same 409, with `— nothing was removed` added to its hint.

---

## 2026-08-07 — There is a web app now: sign in and watch the pipeline

**What a human can now see.** Until today b/sales had no window: everything an
agent wrote through `bk sales` was real and invisible. Sign in at the sales host
and you land on **Today** — the actions due, the ones already overdue, the
meetings coming up across every prospect, and the open pipeline. The nav carries
the rest of the surface; those pages arrive over the next few changes.

It is **read-only on purpose**, and it will stay that way by default. The agent
operates the funnel and the human supervises: nothing on this surface sends a
message, approves a draft or edits a record, and there is no AI running in the
page. Everything shown is a record of something that already happened.

**The whole surface is there now.** Prospects as a table or a board, a prospect
page with the deal journey, its contacts, what they pushed back on and the
products the agent matched to them — plus anything linked to it in another app,
clickable, wherever that app is deployed. The two ledgers, the catalog, the
document library, the metrics, the bin. **⌘K searches inside the records** — a
phrase in a call summary, a name in a meeting outcome, the body of a template —
not just their titles.

**Nothing changed for agents.** No route was added, removed or altered, no `bk`
command changed, and `bk sales` behaves exactly as it did this morning.

**One page in the plan is not there yet:** Activity. It reads platform-wide
event data that this deployment does not serve, so the page and its nav entry
arrive together with the route rather than as a link that goes nowhere. Settings
and super-admin are not built yet either.

**One thing worth knowing if you script against this host.** Routes under
`/api/workspaces/{ws}/…` now also accept a **browser session** where before they
accepted only a `bk_live_…` bearer token — that is what lets the web pages talk
to their own API. A request that sends an `Authorization: Bearer` header is still
resolved from that token and only that token: an invalid token is an answer, not
a reason to fall back to whatever cookie the browser happens to be carrying. If
your token was revoked, you will get a 401 exactly as before.

---

## 2026-08-07 — The sales app is reachable: `bk sales`, fourteen nouns

**What you can now do.** Run blackcode's business-development pipeline from `bk`.
Start with `bk guide sales/pipeline`, then `bk sales --help`.

```bash
bk sales today                       # what is owed today, and today's meetings
bk sales pipeline                    # deal count and value by stage
bk sales metrics --period 90d        # how the last N days went
bk sales search "abacus"             # full text INSIDE this app's records

bk sales prospect list|show|create|edit|assign|stage|next|delete
bk sales contact  list|add|edit|rm
bk sales journey  list|add
bk sales meeting  list|show|schedule|log|outcome|cancel|rm
bk sales comm     list|log|show|rm
bk sales objection list|raise|counter|resolve|rm
bk sales product  list|show|create|edit|delete
bk sales template list|show|create|edit|delete|render
bk sales doc      list|show|add|edit|rm|link|unlink
bk sales match    list|set|clear

bk sales upload <file>               # store a file AGAINST THIS APP
bk sales trash   list|restore|purge|empty
bk sales label   list|view|create|edit|delete|attach|detach
```

Every vocabulary and every limit is served live by `bk meta` under `apps.sales`.
Nothing in the guide or in `--help` restates one, so nothing there can be stale.

**Nine things worth knowing before you script against it.**

1. **Addressed by #number, never by a row id** — for the six record types that
   have one: prospect, meeting, communication, product, template, document. The
   same number is the tail of the URN (`bc:sales:<workspace>/prospect/12`), which
   is what `bk search` and `bk link` use.

   **Contacts, journey steps, objections and matches have NO #number.** They are
   reached through their prospect, by the id their own listing prints — which is
   why `bk sales contact edit 12 3` takes a prospect #number and then a contact
   id. Their listings show an `ID` column and the numbered ones show `#`.

2. **`bk search` and `bk sales search` are different questions.** The first reads
   the shared entity index — titles only, every app — and returns URNs. The
   second reads this app's full text and finds a phrase in a call summary, a
   meeting outcome or a template body. Over the same term they return different
   things, deliberately. `bk guide sales/pitfalls` opens with this.

3. **Deleting takes the NAME, not the number.** `bk sales prospect delete 12
   --confirm "Roches SA"`, required even with `--yes` and even under
   `BK_NO_PROMPT=1`, and enforced by the server rather than only by the binary. A
   mismatch deletes nothing and names the record that IS at that number. Same for
   `meeting rm` (title), `comm rm` (the prospect's name), `product`/`template`/
   `doc` (name or title), `objection rm` (type).

4. **`bk sales objection rm` is permanent.** It is the one hard delete here:
   objections carry no recycle-bin state. Everything else goes to
   `bk sales trash`, is restorable for 90 days, and then purges. Binning a
   prospect bins its contacts, meetings and communications with it, and restoring
   brings back exactly those — not something you binned separately.

5. **Moving a deal is its own command.** `bk sales prospect stage` writes a
   journey step and, on a closing stage, the close date. `prospect edit` refuses
   `--stage` with a 400 naming the right one. `bk sales journey add` records a
   step WITHOUT moving the deal — for the rungs ahead of where a deal is, and for
   history that predates the record.

6. **Send values, not renderings.** `--value 24000` and not `"CHF 24'000"`;
   `--due 2026-08-11` and not `"next Thursday"`. Where the phrase matters,
   `--due-label` keeps your words verbatim beside the resolved date, displayed in
   preference to it and never parsed back.

7. **An empty value clears a field**; omitting the flag leaves it alone. The
   three states are distinct on the wire. If you build a command line from
   variables, an unset one that becomes `""` will CLEAR the field.

8. **`bk sales template render` refuses a missing variable** rather than leaving
   `{{name}}` in the output, and the error names each missing one and the full
   declared set. Placeholders are parsed out of the body on write — there is no
   flag to declare them.

9. **Nothing here computes a match.** `bk sales match set` stores YOUR verdict
   for a (prospect, product) pair, and re-running it replaces that verdict. There
   is no recommendation engine and there will not be one. The aggregate views
   (`today`, `pipeline`, `metrics`) ARE computed, because summing deal values is
   arithmetic rather than judgement.

**Attribution.** Every logged row records who wrote it, and an agent's rows say
so: the label comes from the API token's NAME. `bk token create --name
<something meaningful>` matters more in this app than anywhere else. The deal
**owner** is always a real person — an agent can log a call and write history, it
cannot own a deal.

**Files.** `bk sales upload` stores a file against THIS app: the app segment
decides where it is filed and who answers for it, and there is no bare
`bk upload`. You still list across every app with `bk storage list` — you upload
INTO one app and list ACROSS all of them. `bk guide platform/apps` has the rule.

**Not breaking.** This app had no reachable surface before today.

**Not built yet, so a script does not assume it:** the web UI (read-only and full
modes), and the `⌘K` palette. The app is also not deployed — these commands work
against a deployment that exists from Phase 12 onward.

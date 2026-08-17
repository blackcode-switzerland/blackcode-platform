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

## 2026-08-17 (later) — Drive files know their type, previews go full screen

**Additive.** Three fixes on top of the file-provider work, all found by testing
against real Google Drive files.

**A Drive link now knows what it points at.** `drive.google.com/file/d/<id>/`
carries no type — a video, a pdf and a sheet are the same url shape — so every
Drive document typed as `other` and got a generic icon. The server now asks the
provider with a **one-byte range request** and gets the real mime back
(`video/mp4`, `image/jpeg`, measured). `--kind` stays optional and an explicit
one still wins.

`bk sales doc recheck <n|all>` **backfills** this for documents attached before
the detection existed, and upgrades `kind` from the neutral `link` — never from
a label somebody chose.

**`doc link --template` was write-only.** It has written the link since day one
and nothing ever read it back: not `doc show`, not `template show`, and there
was no filter. A link you could create and never see. `templates` is now served
on the document, printed by `doc show`, and `doc list --template <n>` filters by
it — matching prospects, products and strategies.

**Previews open full screen** instead of expanding inside the list row, over a
dimmed backdrop, with the provider named and a link to the original. Escape or a
click outside closes it. `MediaLightbox` in `@blackcode/platform-ui` is shared,
so any app can use it.

**Two measured limits, recorded because they look like bugs:**

- **A Drive file shows no thumbnail in the list.** Drive's thumbnail endpoint
  cannot be hot-linked into a browser — four variants all refused with
  `ERR_BLOCKED_BY_ORB`, though `curl` fetches it happily, which is why it looked
  fine from the server. The row shows a type icon rather than a broken image.
  **The preview itself is unaffected** — Drive's player was verified loading
  inside the modal.
- A large Drive file answers the type probe with an HTML virus-scan
  interstitial. That is refused rather than mapped, because `text/*` would have
  typed every big video as a document — wrong with conviction.

Also fixed: `updateDocument` never persisted `mime_type`, so any update setting
it silently did nothing. Found when `doc recheck` detected `video/mp4`, reported
success, and changed no row.

---

## 2026-08-17 — the document library previews files and knows where they live

**Additive, nothing breaking** (sales #40). The library rendered every entry as
an identical grey row — a video, an image, a deck and a folder all looked the
same, and nothing said whether a file was ours or somebody else's.

- **Previews by type**, web only: images and video we host play inline, PDFs
  render, Google Drive files use Drive's own viewer. A thumbnail shows in the
  row; the player opens on demand, because ten iframes to a third party is ten
  round trips before the page settles.
- **A badge on every row** saying `Blackcode storage` or `Google Drive`, with
  what that means on hover — who can delete it, and who decides who sees it.
- **`--kind` is now OPTIONAL on `doc add`.** The type is derived from the url; an
  explicit value still wins, because `deck` is a judgement no recogniser can make.
- **`bk sales doc recheck <n|all>`** — re-ask whether an external file is
  viewable. Run `recheck all` once after upgrading: documents added before this
  have no recorded source, and the sweep fills it in.
- **`doc list` gained a SOURCE column** and warns when something cannot be
  previewed; **`doc show`** prints the provider, type, preview status and the
  remedy.
- **`doc link --strategy`** — the fourth attachment point #40 asks for. Prospect,
  product and template have worked since day one; strategies only existed from
  migration 0010.

**What #40 asked for and did NOT get, deliberately:** browsing and picking files
from inside the app. That needs OAuth, a Drive scope, stored refresh tokens and a
security review, and buys little over "the agent supplies a url". The mechanism
is shared (`@blackcode/platform-file-providers`) so any app can adopt it and any
provider can be added.

Migration 0012 adds `documents.storage_provider|external_id|preview_status|
preview_checked_at` and the `document_strategies` link table. The media kind,
embed url and thumbnail are **derived on every read**, so improving the
recogniser improves every existing row with no backfill.

---

## 2026-08-17 — products: internal price guidance, and whose page it is

**Additive, nothing breaking.** Two product-model gaps (#27 part 1, #29).

**Internal-only price guidance.** `--price` is what the catalogue says;
`--internal-price-min` / `--internal-price-max` / `--internal-price-note` are
what a rep may quote. Without them "every rep negotiates blind or has to ask
Andrea directly every time".

```bash
bk sales product edit 3 --internal-price-min 8000 --internal-price-max 12000 \
  --internal-price-note "Hold at 12k unless they commit to the retainer."
```

A RANGE, not a number — a floor with no ceiling is a legitimate answer, and so
is a note instead of either. A floor above the ceiling is refused
(`400 invalid_internal_price`): it is the one mistake this pair can carry that
nothing downstream would notice.

`bk sales product show` prints them under an explicit `INTERNAL — do not quote
this to a customer as our list price` heading; the web catalog shows them in a
labelled block. Both surfaces are behind workspace auth. **If public product
pages are ever built (#26) they must not reuse `publicProduct` or this route** —
they need their own projection that omits these three. That is a rule a person
keeps, not one the database enforces; it is written at the columns, at the view,
and at the type.

**`--reach` and `--external-url`** (#29). `internal` (the default) means the
full page belongs on our domain. `external` means the product has its own brand
and site — AIOS Companion → aioscompanion.com — so our page is a teaser plus an
outbound link rather than a copy of their marketing that goes stale on their next
update. New vocabulary `product_reaches`, served by `bk meta`.

`--external-url` is its own field and **not** a `--ref`. `refs` is reference
CUSTOMERS by name; `aioscompanion.com` was living there, which quietly changed
what that array meant for every reader of it.

**Still open on #27:** product families / bundles (b/suite as a parent of seven
child products). Deliberately not half-built — a `parent_id` with no roll-up
pricing and no UI is the shape that gets found later and mistaken for a finished
feature.

---

## 2026-08-17 — segment strategies, and a per-prospect game plan

**Additive, nothing breaking.** Two issues, and they are two shapes (#37, #35).

**`bk sales strategy` — a new noun.** Why a whole segment was chosen and what it
leads with: "watch & jewellery boutiques in Lausanne, pitched with the AP
configurator demo plus the consciencegems.ch case study". Reusable across ten
prospects, so it is a record with its own #number and URN rather than a field —
copied onto each prospect it would go stale nine times.

```bash
bk sales strategy add --name "…" --vertical "…" --area "…" --why "…" \
  --case-studies "…" --product 3 --product 8
bk sales strategy list | show <n> | edit <n> | rm <n> --confirm <name>
```

Routes: `GET|POST /api/workspaces/{ws}/strategies`,
`GET|PATCH|DELETE …/strategies/{n}`. Web: a **Strategies** page in the sidebar.
Searchable (`bk sales search` gained the `strategy` type) and binnable
(`bk sales trash restore strategy:<n>`).

**`--game-plan` on a prospect** — the other half. What to say to THIS company on
the way into THIS meeting: the upsell angle, the talking points, the objections
to expect. It renders above the ledgers on the prospect page, because it is read
before a meeting rather than after one, and `bk sales prospect show` prints it in
a `GAME PLAN` block.

```bash
bk sales prospect edit 12 --strategy 1 --game-plan "…"
```

Things worth knowing:

- **`--product` REPLACES the set**, it does not add to it. Pass every product the
  strategy leads with; `--no-products` clears it. A product number that names
  nothing is a `404 product_not_found` and **nothing is changed** — the resolve
  is all-or-nothing, so a strategy can never silently store two products when
  three were named.
- **`--strategy ""` unlinks**, like every other patchable field.
- **Binning a strategy does NOT unlink its prospects.** It is a soft delete, and
  detaching them would make it unrestorable — putting the strategy back would
  not put the links back. `strategy rm` reports how many deals still point at it.
- `rationale`, `case_studies` and `game_plan` all carry `platform.blob_references`
  triggers. New limits: `limits.strategy_name_max`, `limits.game_plan_max`.

---

## 2026-08-17 — prospects carry an append-only research log

**Additive, nothing breaking.** Until now `prospects.summary` was the only
free-text field on a prospect, and PATCH **overwrites** it — so recording a
second research finding meant destroying the first. #39 was filed from a real
session where exactly that happened.

New (migration 0009):

```bash
bk sales prospect note add <n> --text "…" [--kind "site audit"]
bk sales prospect note list <n>
bk sales prospect note rm <n> <note-id> --confirm <note-id>
```

Routes: `GET|POST /api/workspaces/{ws}/prospects/{n}/notes`,
`DELETE …/notes/{noteId}`. Web: a **Research** tab on the prospect page, second
after Overview. Notes are full-text searchable — `bk sales search` gained the
`prospect_note` type.

**It is append-only, and there is deliberately no way to edit one.** There is no
PATCH route, no `note edit`, and no pencil in the web UI. `--summary` remains
the field that states the current position and replaces itself; this is the one
that accumulates. An editable log answers "what do we think now", which
`--summary` already answers, and stops answering "what did we know, and when" —
the only question it exists for. If a finding turns out to be wrong, append the
correction.

`rm` **destroys the entry permanently** — this table has no recycle bin, so
`bk sales trash restore` has nothing to take — and requires `--confirm` naming
the note's own id. It prints the whole note it destroyed. The confirmation is
the weaker of this repo's two shapes (it cannot catch a wrong id, since a wrong
id is what you would repeat); the printed receipt is what covers that, so a
mistake shows up in the next line of output.

Each note records **who** wrote it, from the API token's name — most of these are
agent-written, and a log you cannot attribute is one you cannot weigh.

`body` is covered by a `platform.blob_references` trigger, so a screenshot url
pasted into a site audit is accounted for by the blob delete gate. Caps are
`limits.prospect_note_body_max` and `limits.prospect_note_kind_max`; `bk meta`
carries them.

---

## 2026-08-17 — every web listing prints the #number

**Additive, nothing breaking.** Filed as a sorting bug (#30): "`bk sales product
list` sorts alphabetically, the web page doesn't, so 'the third one' means
different things to a human and to an agent."

**Measured, the two surfaces were already in the same order.** Both render
`GET …/products` verbatim, ordered `(category, name)`, and the CLI applies no
sort of its own. The real defect was that **no listing in the web app printed
the #number at all** — so the only way a human could name a row was by its
position, and a position is not an address: it moves on a rename, on an insert,
and whenever a filter is on.

The #number now appears on prospects (table and board), products, templates,
meetings, communications, documents, and the prospect detail header — the same
number `bk` prints. A human reads "#1" off the screen and an agent resolves it
without translation.

Neither fix the issue proposed was taken, and both are now unnecessary: a
`position` column and "sort the CLI like the web" would each have made two
already-identical orders identical, and left the human with nothing to say but
"the third one". **No sort order changed**, so any script or agent relying on the
current ordering is unaffected.

---

## 2026-08-17 — the identity card: a company's site and address, a person's LinkedIn and decision power

**Additive, nothing breaking.** Two issues (#34, #33) were filed the same day
saying the app holds nothing about the people at a prospect — "reps can't call,
email, or look up their own contact without hunting elsewhere".

**Half of that was already built and nobody could find it.** `sales.contacts`
has carried `name`, `role`, `email`, `phone` and `notes` since day one, served
by `bk sales contact add/edit/list/rm`. A prospect is where you look; the
contacts were one level down behind a sub-route there was no reason to guess at.
So the discoverability half is fixed where the problem actually was:

- `GET /api/workspaces/{ws}/prospects/{n}` now serves a **`contacts`** array
  alongside `journey`. `…/prospects/{n}/contacts` is unchanged and remains the
  write surface.
- `bk sales prospect show <n>` prints a **CONTACTS** block.
- The web prospect page renders email as `mailto:` and phone as `tel:` — a
  number you can ring from the page you are already on, rather than text.

Four columns genuinely had nowhere to go, and they are new (migration 0008):

| Field | Where | Flag |
|---|---|---|
| `website` | prospect — the COMPANY's site | `bk sales prospect add/edit --website` |
| `address` | prospect — one postal line | `bk sales prospect add/edit --address` |
| `linkedin` | contact — the PERSON's profile | `bk sales contact add/edit --linkedin` |
| `decision_power` | contact | `bk sales contact add/edit --decision-power` |

`decision_power` is a new vocabulary — `economic | champion | influencer |
gatekeeper | user` — served by `GET /api/meta` under `vocabulary.decision_powers`
and by `bk meta`. It records what somebody can **do** in a deal rather than
their job title. The freeform person intel stays `--notes`, which predates both
issues.

`--website` and `--linkedin` are refused unless they are `http` or `https` URLs
(`400 invalid_website` / `400 invalid_linkedin`). That is not fussiness: both are
rendered as anchors by the web app, and `javascript:…` is a well-formed URL.
Both are capped at `limits.contact_url_max`, `address` at
`limits.prospect_address_max`; `bk meta` carries the numbers.

**Adapting:** nothing is required. On PATCH all four are three-way like every
other field — passing `""` clears one, omitting the flag leaves it alone. All
four columns are covered by `platform.blob_references` triggers, so a file url
pasted into any of them is still accounted for by the delete gate.

---

## 2026-08-17 — `bk sales match set` works again: a numeric body field is a number

**Bug fix, not breaking.** `bk sales match set <prospect> --product <n>` had
never worked from the CLI. It answered `400 missing_product` naming a product
that exists — the most misleading shape a 400 can take, because it told the
caller to go look up a number they had already passed correctly. `--template`
had the identical defect.

The route read its two numeric body fields through the free-text trimmer
(`numberOr(str(body?.product))`), which returns undefined for anything that is
not a string. `bk` sends `{"product": 8}` — a JSON **number** — so the field
read as absent. Every other route in this app reads its numbers from the query
string, where that pairing is correct; this is the only one that reads them
from a JSON body, and it was the only one carrying the bug.

**Nothing to adapt.** Both spellings are accepted: `{"product": 8}` and
`{"product": "8"}`. A non-numeric value is still a `400 missing_product`, and a
number that names no product in the workspace is still a `404 product_not_found`
— previously unreachable, because the request never got that far.

---

## 2026-08-12 — `prospect show` stops promising a LINKED section it cannot print

**Not breaking**, and the visible output is unchanged for everyone — because the
section being removed had not appeared since 2026-08-10.

`bk sales prospect show <n>` rendered a `LINKED` block listing every cross-app
link touching the prospect, and its `--help` said so: *"every cross-app LINK
touching this prospect, each with an absolute URL you can follow into the other
app."* `GET /api/workspaces/{ws}/prospects/{n}` stopped serving the `links` field
on 2026-08-10, when this app stopped reading `platform.links`. So the block was
already unreachable and the help was already wrong — the CLI decoded an absent
key into an empty slice on every call and printed nothing.

Removed: the `LINKED` section, the `SalesLink` type and the `Prospect.Links`
field. `--help` now describes what the command actually prints — the deal
journey, and **the prospect's URN**.

**The URN is the mechanism, and it is not a consolation prize.** To relate a
prospect to a record in another app, put the far end's URN in the record's own
text:

```bash
bk sales prospect show 8            # prints bc:sales:acme/prospect/8
bk sales prospect edit 8 --summary "Blocked on bc:issues:acme/issue/512 — SSO"
```

Write it into BOTH records, or it is findable from one side only. There is no
command that records the relation for you and there is not going to be one:
`bk guide sales/cross-app` and `bk guide platform/cross-app`.

## 2026-08-12 — meetings carry a link, documents filter by tag and product, and `meeting edit` exists

**Not breaking. Every route, flag and spelling that worked yesterday still
works**; everything below is additive except one display label, noted at the end.

### Meetings have an optional link

`sales.meetings` gained a nullable `meeting_url` (migration 0007). It is the join
URL of an online meeting — Teams, Meet, Zoom, Whereby, an internal room.

```
bk sales meeting schedule 3 --at 2026-08-20T10:00:00Z --type video \
    --title "Platform demo" --link https://meet.google.com/abc-defg-hij
bk sales meeting log … --link …
bk sales meeting edit 12 --link https://zoom.us/j/123456789   # change it
bk sales meeting edit 12 --clear-link                          # remove it
```

`meeting show` prints a `link` row when there is one and **omits it entirely
when there is not** — most rows in this ledger are phone calls, and a `link —`
line on every one of them buries the rows that do have one. `meeting list`'s
columns are unchanged; `--json` and `--yaml` carry `meeting_url` on every meeting
(`null` when unset), so a client that reads the field positionally should read it
by name instead.

On the wire: `POST …/meetings` and `PATCH …/meetings/{n}` accept `meeting_url`,
and every meeting response carries it. **`{"meeting_url": null}` clears it.**

**Only `http`/`https` are accepted.** A `javascript:` or `data:` URL is a
well-formed URL and would become a stored XSS in the link the web app renders, so
those are refused with `invalid_meeting_url`. Nothing else is validated — a
provider you have never heard of and an internal hostname both work.

### `bk sales meeting edit`

New verb, on the `PATCH …/meetings/{n}` route that already existed. Takes
`--title`, `--agenda`, `--at`, `--link` and `--clear-link`; only the flags you
pass are sent. Until now the CLI reached that route through exactly two keyholes
(`outcome` writes an outcome, `cancel` writes a status), so the web app could fix
a meeting's details and an agent could not.

To record how a meeting WENT, keep using `meeting outcome` — that also marks it
as having happened, which `edit` deliberately does not. `edit` with no flags is
an error rather than a silent no-op.

### Documents filter by tag and by product

```
bk sales doc list --tag pricing              # any document tagged pricing
bk sales doc list --tag pricing --tag demo   # either — OR, so this WIDENS
bk sales doc list --product 4                # linked to product #4
```

**Nothing here added a tagging system.** `--tag` has been writable on
`bk sales doc add` since the app shipped and `doc link --product` just as long;
only the read path was missing, so both were stored and unreachable.

- **Multiple tags match with OR**, not AND. A second `--tag` returns MORE, not
  fewer. Free-text tags on a small library almost never intersect, so AND would
  return nothing for most pairs.
- **Tags are case-insensitive.** `--tag Deck` and `--tag deck` are the same
  filter.
- **An unknown tag is not an error** — there is no vocabulary to check against,
  so it is a filter that matches nothing. `--kind` still 400s on an unknown
  value, because that one has a vocabulary.
- On the wire: `GET …/documents?tag=a,b&product=4`.

`--prospect`/`--product` are single values on `doc list` (a thing to filter BY)
and repeatable on `doc add`/`doc link` (things to attach TO). That difference is
deliberate.

### The web app

Filters on Meetings (prospect, status), Communications (channel, direction,
prospect), Templates (channel, category) and Documents (kind, prospect, product,
tag) — all held in the URL, so a filtered view is a link you can send. A filtered
listing that matches nothing now says *"No meetings match this filter"* rather
than *"No meetings"*, which previously read as data loss. Templates gained a copy
button for the body and, separately, the subject; `{{placeholders}}` are copied
verbatim. The workspace switcher names the OWNER of a workspace that is not yours
instead of labelling it "Member". Every native `<select>` was replaced with the
picker both apps share.

**The web UI no longer prints `bk` commands at its readers**, and the bare URN
chip is off the prospect header. Neither capability changed: the URN is still on
the wire and still what `bk sales prospect show` prints, and the commands are
still `bk sales --help` and `bk guide`. See `docs/changelog/platform.md` for the
invitation change, which is shared by every app.

### One display label changed: `out`/`in` read as "Sent"/"Received"

The `comm_directions` vocabulary's LABELS changed from `Outbound`/`Inbound` to
`Sent`/`Received`. **The values are untouched** — `--dir out` and `--dir in` are
what they always were, and nothing an agent sends or a route validates moves.
Only the human-facing label in `bk meta` and the web UI changed.

---

## 2026-08-12 — every vocabulary flag names its values, and "which prospect" takes either shape

**Not breaking. Nothing was renamed and no route changed** — every spelling that
worked yesterday still works.

An agent that ran the whole sales surface found two inconsistencies, and both
trained it to guess:

**1. Twenty flags take a vocabulary value; six named their values and fourteen
said "run `bk meta`".** So it learned from one flag that the values were in the
help, and was failed by the next: it tried `--type discovery` on
`meeting schedule` (a *channel* value) and `--category outreach` on
`template create`, and paid a round trip each time.

Every one of them now names its values AND keeps the `bk meta` pointer:

```
--kind    pdf | deck | image | video | link (required; `bk meta` for values)
--stage   new_lead | contacted | meeting | negotiation | won | lost (repeatable; `bk meta` for values)
```

**`bk meta` is still the authority.** The enumeration is a copy held to
`apps/sales/lib/pipeline.ts` by a build-time check
(`apps/sales/lib/cli-vocabulary.test.ts`), so a value added here and not there
fails the build rather than shipping a `bk` that prints a stale list. If your
binary's `--help` and `bk meta --vocab <key>` ever disagree, **the server is
right** — see `bk meta --vocab` in the platform changelog.

**2. "Which prospect?" had two conventions.** `contact add 12` and the objection
verbs took it positionally; `comm log --prospect 12` and the meeting verbs took a
flag. Carrying one shape into the other family dead-ended
(`objection counter 1 --prospect 8`).

**Both shapes now work on every command that acts on a prospect** — the contact,
objection, journey, match and label verbs, `prospect next`, `prospect stage`,
`comm log` and `meeting schedule|log`:

```bash
bk sales contact add 12 --name "Julien Roche"
bk sales contact add --prospect 12 --name "Julien Roche"    # identical
bk sales comm log 12 --channel email --dir out              # identical
```

Naming two DIFFERENT prospects is an **error** naming both, and nothing is
written — it is never resolved silently in favour of one.

Also in this change:

- **`bk sales doc add --prospect/--product/--template`**, each repeatable:
  create a document and attach it in one call, over the same links `doc link`
  writes. `doc link` remains the way to attach a document that already exists.
  If the document is created and a link then fails, the error says the document
  **was created** and names its #number — do not add it twice.
- **Confirmations name the company, not just the id.** `added contact 1 to
  prospect #2` is now `added contact 1 to prospect #2 (Roches SA)`; the same for
  `objection raise`, `journey add`, `match set`, `label attach`, `comm log` and
  `meeting schedule|log`. `--json` payloads are unchanged.
- **`bk sales meeting --help`** now says how `log`, `schedule` and `outcome`
  relate, instead of listing three verbs with no relation between them.

`--json` output is unchanged throughout. Nothing here needs a client change.

## 2026-08-11 — `--help` now names every field the server refuses without

**Not breaking. Help text only — no route, no behaviour, no flag added or removed.**

An agent composing `bk sales product create` has two sources for "what does this
need?": the flag descriptions, and a 400 from the server. The second worked —
these routes answer `missing_name` / `unknown_category` with a suggestion naming
the flag — but it costs a round trip, and a round trip mid-run is where a task
gets abandoned.

Checked every sales create surface against its route. **Eight flags were enforced
server-side and did not say so:**

| Command | Was silent about |
|---|---|
| `bk sales product create` | `--name`, `--category` |
| `bk sales template create` | `--name`, `--channel`, `--category` |
| `bk sales doc add` | `--kind`, and that `--upload`/`--url` is exactly one of the two |

`prospect create`, `meeting schedule|log`, `comm log`, `contact add` and
`objection raise` were already correct, which is what kept the gap invisible —
the app looked consistent from any single example.

Dynamic values are still not listed in help or in `bk guide`: a flag says
`bk meta for values` and `bk meta` carries the current vocabulary, so a stage or
category can change without a CLI release.

## 2026-08-11 — you can be in more than one workspace, and now you can move between them

**Not breaking.** Nothing changes for a person with one workspace, which is
everyone today: the switcher renders nothing and the app looks exactly as it did.

**The situation it fixes.** Invite somebody into your workspace and they end up
in TWO — signing in mints their own (the bootstrap is keyed on membership, and
they have none until they accept), then accepting adds yours. Measured by
running the real sequence, not read off the code. `/dashboard` answered that
with a full-page "Choose a workspace" screen, and the app offered **no way back
to it**: every link in the sidebar is `/dashboard/{ws}/…`, the logo included.
You chose once, then you were stuck there.

**What is new:**

- **A switcher in the sidebar**, under the b/sales mark. It lists every
  workspace you belong to, labelled *Your workspace* or *Member*, and appears
  only when there is more than one.
- **The choice is remembered**, in `sales.user_settings` — this app's own
  schema, never `platform.users.active_workspace_id`, which holds another app's
  workspace ids and would collide. `/dashboard` now opens where you last were
  instead of asking again. The picker survives for the one case that is still a
  guess: more than one workspace and nothing chosen yet.
- **The web and `bk` agree.** The sidebar switcher and
  `bk sales workspace use <slug>` both write `POST /api/me/active-workspace`, so
  switching in one is visible in the other.
- **`bk login` seeds the active workspace**, so a fresh login can run
  `bk sales prospect list` immediately. Before this it failed with "no active
  workspace for the sales app" until you ran a command nothing had told you
  about — for a value the server had already computed.
- **`bk --ws <slug> sales …`** targets one command elsewhere without switching.

**A workspace you are removed from stops being your default**, rather than
sending you to a page that 404s: the stored pointer is resolved against your
memberships on every read.

## 2026-08-11 — A super admin can invite any blackcode account from the members page; the front door wears the site's frame

**Not breaking.** No route changed shape and no command changed spelling. One
route answers with more rows than it used to, for one kind of caller.

**`GET /api/workspaces/{ws}/invite-candidates` — widened for super admins.**

- Every candidate now carries **`from_platform`** (boolean). `false` means "you
  already share a sales workspace with this person" — the only kind of row this
  route used to return. `true` means "this person has a blackcode account and
  you are a super admin", and those rows have an empty `shared_workspaces`.
- **For a super admin**, the response now includes every live `platform.users`
  account, in addition to the shared-workspace people. **For everybody else the
  response is unchanged** — still only the people you share a sales workspace
  with, which remains the privacy rule this route was built on.
- The existing fields are untouched, `is_super_admin` still reports the same
  thing, and the envelope is still `{ data, is_super_admin }`.
- **For `bk sales invite candidates`:** a super admin will see more rows than
  before. Nothing to change; if you were relying on the list being only your own
  colleagues, filter on `from_platform == false`.
- Candidates are now sorted joinable-first (`already_member` rows last), then
  alphabetically. Do not depend on the order — sort what you read.

**Web UI.**

- `/dashboard/{ws}/members` renders the candidate list for super admins, with a
  search filter and a one-click Invite per person. It is hidden for everybody
  else, off the server's `is_super_admin`, and the invite-by-email field is
  unchanged and still the way to invite somebody who has no account yet.
  There is still **no super-admin page in b/sales** and there will not be one.
- `/login` (sign-in, create-account and forgot-password) now carries the landing
  page's header and footer, so the brand links back to `/`.
- **Continue with Google** now shows the Google mark and sits **above** the
  email/password form rather than below it. Same provider, same flow, same
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` gate — a deployment without them
  still draws no button.

---

## 2026-08-11 — Members moved into the sidebar; settings keeps the app frame; b/sales has a front page

**Not breaking for `bk`.** No route changed shape, no command changed spelling.
Everything below is the web UI, except one corrected sentence that an agent could
have been reading.

**One command reference in the app was WRONG and is fixed.** The Documents page
told you documents were "linked with `bk sales doc create --url`". There is no
`doc create` — the verb is **`bk sales doc add`**, and it wants `--title` and
`--kind` as well as `--url` or `--upload`. If you scripted from that sentence,
that is why it exited with `unknown command`. Every other `bk …` spelling printed
by this app's UI was checked against the binary the same day and is real.

**`/dashboard/settings/members` moved to `/dashboard/{ws}/members`** and is now a
sidebar entry, above Trash. Members is a property of the workspace, not of your
blackcode account, and the four pages it used to sit beside are all account
pages. **The old URL still works — it redirects**, so a bookmark is not a 404.
The API is untouched: members are still `GET/POST /api/workspaces/{ws}/members`.

**Settings renders inside the app frame.** It used to lose the sidebar entirely
because it lives outside the `/dashboard/{ws}` segment. The URL is unchanged;
only the chrome around it moved.

**Your profile photo can be set here.** `PATCH /api/me` has always accepted
`avatar_url` and this app has always mounted `POST /api/upload`; the settings
page simply never rendered the control, so a b/sales user had to go to b/issues
to change a field on the account both apps share. Photos now show in the sidebar
and the members list, with initials on a derived colour when there is none.

**`/` is a landing page rather than a redirect.** Signed-in visitors still go
straight to `/dashboard`.

**Cosmetic, but visible:** the app has a favicon; command names printed in empty
states render as code rather than as literal backticks; and the `b/` mark is one
image everywhere (sidebar, sign-in, landing page) instead of three different
drawings of it.

---

## 2026-08-11 — Sign up, reset a forgotten password, and change your password here

**Not breaking**, with one changed response shape on a browser-only route.

b/sales has front doors now. All three were capabilities the app already had, or
could have had, with nothing linking to them:

- **`/login` has a "Create account" tab.** `POST /api/auth/register` has existed
  since 2026-08-10 and minted a workspace on success; nothing on screen reached
  it. The whitelist gate is unchanged and still server-side — the account this
  creates is the shared platform account, so an ungated sign-up here would be an
  ungated sign-up everywhere.
- **`/login` has "Forgot password?"** New routes:
  `POST /api/auth/password-reset/request` and `/confirm`.
- **Settings → Account changes your password here.** New routes:
  `POST /api/me/password/request-otp` and `/confirm`. It used to link out to
  another app, because b/sales could not send the one-time code the change
  needs. It can now.
- **Invitation emails are actually sent.** `email_sent` in the response to
  `POST /api/workspaces/{ws}/invitations` was a hardcoded `false`; it is the
  real result. `accept_url` is still returned either way.

**Changed response shape:** `POST /api/auth/register` now answers the platform
error envelope `{ error, code, suggestion }` instead of `{ error, message }`.
`error` is the human sentence and `code` is what a client branches on — so a
whitelist refusal is `code: "not_in_whitelist"` with a readable `error`, where
before `error` itself carried the string `not_in_whitelist`. Browser-only route;
no `bk` command reaches it.

**The login page's footer was wrong and is fixed.** It said "Ask a workspace
owner to invite you and grant you b/sales." There has been nothing to grant
since `platform.app_access` was dropped on 2026-08-10 — each app owns its
workspaces and membership is the whole gate — and access is no longer
invitation-only.

**Changing your password signs you out of every app**, not just this one. It is
one credential; that was always true and is now stated on the page.

`RESEND_API_KEY` and `RESEND_FROM_EMAIL` must be set on this project. Without
them, password resets refuse in production with `503 email_not_configured`
rather than silently not sending. See `platform.md`.

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

# Frontend — platform

> **2026-08-04 — this file was split along the platform/app line** (Phase 5 of
> `2026-08-platform-migration.md`). What stayed here is what every app inherits:
> the theme and token system, `components/ui/` primitives, the shared design
> primitives, the app shell and providers, the workspace-scoped URL model, and
> the data-fetching conventions.
>
> **The issue tracker's own dashboard routes, feature components and analytics
> view moved to [`apps/issues/docs/frontend.md`](../apps/issues/docs/frontend.md).**
> Root docs never describe an app's internals (platform-architecture.md §7.5).
>
> **Paths are relative to `apps/issues/`.** Much of the design system has already
> moved to `packages/platform-ui` (Phase 2); what is named here as
> `components/ui/…` is re-exported from there.

The shared web layer: stack, the theme system, the component primitives, and how
data flows. **Source of truth is the code** — this describes it as it is today
(a monochrome, Linear-style dashboard on Next.js 16 + Tailwind v4).

## Table of contents

- [Stack](#stack)
- [Project layout](#project-layout)
- [Configuration files](#configuration-files)
- [Theme & styling system](#theme--styling-system)
- [The chart kit](#the-chart-kit--blackcodeplatform-uicharts)
- [Routes](#routes)
- [App shell & providers](#app-shell--providers)
- [Interface language](#interface-language--blackcodeplatform-i18n)
- [Components](#components)
- [Shared design primitives](#shared-design-primitives)
- [Workspace management](#workspace-management--one-experience-in-every-app)
- [State & data fetching](#state--data-fetching)
- [Conventions](#conventions)

**App docs:** [`apps/issues/docs/`](../apps/issues/docs/) ·
[`apps/sales/docs/`](../apps/sales/docs/) ·
[`apps/books/docs/`](../apps/books/docs/) — and in particular
[`apps/books/docs/frontend.md`](../apps/books/docs/frontend.md) §9, the worked
example of the language switch.

> **One of the three front ends WRITES NOTHING.** `apps/books`' web surface is
> read-only by design (its §5, "the surface is read-mostly, and that is
> checked"): every write — posting an entry, importing a statement, resolving a
> bank line, closing a year — is a `bk books` command. Two things follow for
> anyone reviewing frontend work here. A books screen with no mutation is not an
> unfinished screen, so do not "add the missing button"; and the conventions
> below that describe mutations, optimistic updates and `toast.success` on every
> write apply to issues and sales, and to books only where a genuinely shared
> primitive (the account surface, the language switch) writes.

## Stack

- **Next.js 16** App Router, **React 18**, **TypeScript** (strict).
- **Tailwind v4**, CSS-first — there is **no `tailwind.config`**; tokens and
  utilities are declared in `app/globals.css` via `@theme inline`.
- **TanStack Query** for all server data.
- **next-themes** for light/dark (class strategy).
- **TipTap** for rich text (`@blackcode/platform-ui/rich-text-editor`).
- **sonner** for toasts, **lucide-react** for icons, **date-fns** for dates,
  **@hello-pangea/dnd** for kanban drag-and-drop.
- A few **shadcn-style** primitives live in `components/ui/`, but most UI is
  bespoke Tailwind. `zustand` and `framer-motion` are dependencies but are not
  currently load-bearing — app state is TanStack Query + local React state.

## Project layout

```
app/
  layout.tsx          root layout (fonts, metadata, <Providers>, <Toaster>)
  providers.tsx       client provider tree
  globals.css         Tailwind v4 entry + design tokens + a little legacy CSS
  page.tsx            landing page
  login/              auth (sign-in / sign-up / password reset)
  privacy, terms      marketing/legal
  status/             public status + error pages
  invitations/[token] invitation accept/decline
  cli/authorize       CLI token grant screen
  dashboard/          the authenticated app (see Routes)
  api/                route handlers (documented in docs/backend.md)
components/
  ui/                 primitives (buttons, modal, confirm dialog, date picker,
                      work-item icons, property select, member avatar, …)
  listings/           list/kanban/timeline views + filter bar + bulk actions + active-ws hook
  marketing/          public site chrome
  *.tsx               feature components (detail views, create modals, settings)
lib/                  shared client/server helpers (work-items.ts lives here)
```

## Configuration files

- **`tsconfig.json`** — strict; path alias `@/*` → project root; `jsx:
  react-jsx`; `moduleResolution: bundler`.
- **`next.config.js`** — allows `lh3.googleusercontent.com` images (Google
  avatars); Server Actions origin allow-list for localhost + the Vercel domain.
- **`postcss.config.js`** — single plugin `@tailwindcss/postcss` (Tailwind v4).
- **`components.json`** — shadcn config: `style: new-york`, `baseColor: slate`,
  CSS variables on, `css: app/globals.css`, **no** tailwind config path,
  aliases (`@/components`, `@/lib/utils`, `@/components/ui`), `lucide` icons.
- **No `tailwind.config.(js|ts)`** — intentional; Tailwind v4 is configured in
  CSS.

## Theme & styling system

### One source of truth

`app/globals.css` is the only place to re-theme. It has three blocks:

1. **`:root` / `.dark`** — the token **values** in OKLCH.
2. **`@theme inline`** — maps Tailwind utilities (`bg-primary`, `text-muted-
   foreground`, …) to those variables. You rarely touch this.
3. A small **legacy / component-CSS** tail (kanban classes, the `.prose`
   TipTap output styles, the `.mention` chip, scrollbars).

### The palette

Surfaces are **pure neutral** (OKLCH chroma 0 — a true monochrome
black/white/gray system in the Linear spirit). The only chromatic tokens are:

- **`--primary: #007bd3`** — the single brand accent (buttons, selection, focus
  rings, `--ring`, sidebar/chart-1).
- **`--destructive`** — red, for dangerous actions.

Both light (`:root`) and dark (`.dark`) are defined; default is dark. Status and
priority colors are **not** here — they're canonical in `lib/work-items.ts` and
rendered by the work-item icon set.

### Fonts

`--font-sans` is **Google Sans** (loaded via a `<link>` to Google Fonts in
`app/layout.tsx`, not `next/font`). `--font-mono` is a real mono stack used for
tabular IDs.

### Re-theming

Change the brand accent by editing `--primary` (and `--ring`,
`--sidebar-primary`, `--chart-1`) in both `:root` and `.dark`. To shift surfaces
off pure-neutral, give the OKLCH values a non-zero chroma. Don't hard-code
colors in components — use the token utilities.

## The chart kit — `@blackcode/platform-ui/charts`

Hand-rolled themed SVG. **No chart library, and none is wanted**: `KpiCard`,
`TrendBadge`, `Sparkline`, `AreaLineChart`, `DonutChart`, `HorizontalBars`,
`ColumnChart`, `BurndownChart`. Every one takes pre-computed data and returns
SVG — no fetching, no formatting decisions, no app vocabulary.

It lived in `apps/issues/components/analytics/` until 2026-08-06 and moved here
under D-12, when a second app needed four of the six. A copy would have drifted
within months and a cross-app import is what `app-isolation.test.ts` exists to
refuse.

**The kit names no colour.** `SERIES` is four CSS variables and the app defines
them:

| Token | Role |
|---|---|
| `--chart-series-created` | new work arrived |
| `--chart-series-completed` | work finished |
| `--chart-series-activity` | things happened |
| `--chart-series-ideal` | the reference / target line |

That is the whole extension point: issues defines them blue-and-green, sales
defines them emerald-teal, and neither app branches on the other. **An undefined
token resolves to nothing and the stroke silently disappears** — so these four
are an obligation for any app that mounts the kit, not a nicety.

> **The kit is for COUNTS, and `apps/books` deliberately does not mount it.**
> Added 2026-08-19, when the first money chart on this platform was built.
> `HorizontalBars` takes `value: number` and renders it with `formatNumber`
> (`13350` → `13.4K`); `ColumnChart` shows "No data." when its total is zero;
> `AreaLineChart` draws a line between points. Each is right for issues' and
> sales' counts and wrong for a bookkeeping amount, which crosses the wire as a
> `numeric` STRING and must never be parsed on its way to the screen, whose
> zero months are real, and whose monthly series is sparse and must not be
> interpolated. Books writes its own two chart components and records why in
> `apps/books/docs/frontend.md` §4bis. **If a third app needs money charts, that
> is the moment to lift a money-shaped variant into this kit** — not before, and
> not by widening `BarItem.value` to `string | number`, which would put the
> parse back at every call site.

Two guards, and they cover different halves:

- `apps/issues/lib/charts-parity.test.ts` renders every component to static
  markup, resolves the tokens through `app/globals.css`, and compares the result
  with a recording taken before the move. It catches a shifted colour, a dropped
  gridline, a changed coordinate — none of which any other test in this repo can
  see.
- `packages/platform-testing/test/ui-package-styling.test.ts` catches the other
  half: markup can be identical while the CSS behind a class does not exist.
  See below.

> **`transpilePackages` makes the TypeScript compile; `@source` makes the CSS
> exist.** Tailwind v4 skips `node_modules`, and the platform packages reach an
> app through a workspace symlink there — so an app's stylesheet must carry
> `@source "…/packages/platform-ui/src";` or every class used *only* inside the
> package is silently never generated. When this was found on 2026-08-06 it was
> **151 classes** in `apps/issues`, including the login page's tab active state
> and the landing page's accordion animation. There is no error and no build
> failure; the page just renders slightly wrong.

### Notable CSS helpers

- **Toast bridge** — `--toast-bg/-text/-border` are read by the `<Toaster>`
  inline style so sonner matches the theme.
- **`.mention`** — the `@mention` chip style used inside TipTap content.
- **Marketing backgrounds** — `.bg-grid*`, `--brand-gradient`, `--hero-glow`,
  `.text-gradient-brand` for the public pages.
- **Legacy** — `.kanban-*`, `.status-*`, and `.prose` are older classes still
  used in a few spots; new work uses the shared primitives and token utilities.
  (The `.status-blocked` / `.status-in_review` classes are leftovers — those
  statuses no longer exist.)

## Routes

Public routes only — an app's authenticated dashboard routes are its own. See
[`apps/issues/docs/frontend.md`](../apps/issues/docs/frontend.md) for the issue
tracker's.

### Public

| Path | Renders |
|------|---------|
| `/` | Landing page (`LandingPage`). Signed-in visitors are redirected to `/dashboard` unless the URL has `?from=app` (set by the "blackcode" brand link in the dashboard sidebar), which lets them browse the landing page without being bounced back in. |
| `/login` | Sign-in / sign-up tabs + password-reset flow |
| `/blocked` | Shown when a non-whitelisted email tries Google OAuth; professional "not on the list" page |
| `/privacy`, `/terms` | Legal pages (marketing layout) |
| ~~`/changelog`~~ | **Removed 2026-08-03.** The public changelog page had no human audience. The record itself is unchanged and still served to agents via `GET /api/changelog` and `bk changelog`, both rendering `docs/changelog/*.md` through `@blackcode/platform-agent`. **Since 2026-08-11 the path 307s to `/api/changelog`** (`next.config.js` `redirects()`) — it was a link shared with agents for self-diagnosis and a bare 404 does not say that the surface moved one segment. The redirect is not a reinstatement: do not add a page here. |
| `/agent-updater` | **Not a page — a 307 to `/agent-updator`.** The real path has always carried the typo, and it is load-bearing (the `X-BK-Help` header, `/api/docs`, the changelog all name it), so the correctly-spelled guess is redirected rather than the page renamed. Added 2026-08-11 after both spellings were shared with agents and one 404'd. |
| `/agent-updator` | Public "get an agent current" guide (`app/agent-updator/page.tsx`, marketing layout) — how an AI agent / stale agent skill should connect: recommended interface (`bk` CLI), install/update, auth, integration gotchas, OS-specific notes (Windows UTF-8 / `chcp 65001`, macOS, Linux), why an old CLI is version-floored (exit code 8), and links to discovery endpoints. Pulls its connection facts from `lib/agent-manifest.ts` + `@blackcode/platform-agent` so it can't drift. |
| `/status` | Public health page (DB / blob / app probes + recent errors) |
| `/status/errors/[id]` | Error detail (owner-gated) |
| `/invitations/[token]` | Accept/decline a workspace invite |
| `/cli/authorize` | Grant a token to the `bk` CLI |

## App shell & providers

`app/layout.tsx` sets metadata + the Google Sans `<link>`, renders
`<html lang="en" suppressHydrationWarning>`, mounts `<Providers>`, and a sonner
`<Toaster position="bottom-right">` styled from the toast-bridge variables.

`app/providers.tsx` nests, outermost → innermost:

```tsx
<SessionProvider>                 {/* NextAuth */}
  <QueryClientProvider>           {/* staleTime 60s, refetchOnWindowFocus off */}
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem
                   disableTransitionOnChange>
      <ConfirmProvider>           {/* imperative confirm/prompt — useConfirm() */}
        {children}
```

`app/dashboard/layout.tsx` renders `OnboardingCreateWorkspace` ("create your
first workspace") when the user belongs to no workspace, and the shell
otherwise. It used to tell **two** empties apart — no memberships, and
memberships with no app access — until `app_access` was dropped on 2026-08-10:
an app's workspaces are its own now, so membership is the whole gate and there
is only one empty.

## Interface language — `@blackcode/platform-i18n`

**Added 2026-08-20 for `apps/books`. `apps/issues` and `apps/sales` are
English-only today and inherit both the column and the mechanism whenever they
want them.**

The preference is **`platform.users.locale`** — one column on the shared identity
row — so a person who chooses French in one app has chosen it in all of them.
The package holds the **mechanism**; each app holds its **strings**. That split
is not negotiable: books' vocabulary is not sales', and a shared dictionary is
where two products' words collide. It is the same line `platform-email` draws
between an app's identity and the shared templates.

### The resolution order, written once

```
user record  →  cookie (bk_locale)  →  Accept-Language  →  default ('en')
```

In the package, so two apps cannot disagree about it.
`packages/platform-testing/test/locale-resolution.test.ts` pins every step
separately.

**`platform.users.locale` is NULLABLE, and null means "never chosen" — not
"chose English".** That is what keeps the third step reachable: a
`NOT NULL DEFAULT 'en'` backfill would answer step one for every account that
already exists. An unrecognised stored value (`'de'`) **falls through** to the
cookie rather than defaulting, which is why the column carries no CHECK
constraint. Migration `apps/issues/lib/db/migrations/0048_users_locale.sql`
argues all of it.

### The two guards, and which one to reach for

- **The type is the strong one.** `Dictionary<K>` is
  `Record<Locale, Record<K, string>>`, so a key present in English and missing in
  French is a `tsc` error — at the call site *and* in the other language's table.
  It cannot be worded wrongly and cannot go inert. Prefer it wherever it reaches;
  it even covers computed keys (`` t(`f${n}.title`) `` narrows with no cast).
- **A text scan is the weak one**, for a string that never reached the dictionary
  at all. It belongs in the app, not here — `apps/books/lib/hardcoded-strings.test.ts`
  is the pattern, and its header names the six things it cannot see.

**A `lib/` module that holds copy holds KEYS, not words.** A pure function
cannot call a hook, so a table of English prose in `lib/` is invisible to every
scan. `apps/books/lib/{nav,compliance,verdict}.ts` were converted for exactly
this reason.

### No flash — and never a `useEffect`

The locale is on the session row, so a **server component resolves it and the
first paint is already correct**. This is strictly easier than the theme, which
needs a blocking script because `localStorage` is unreachable from the server.

```tsx
const locale = await getLocale(user?.locale ?? null)   // app/layout.tsx
return <html lang={locale}>…<Providers locale={locale}>…</Providers></html>
```

**A page that renders English and flips to French after mount is worse than one
that never offered the choice** — it looks broken, it moves layout under the
reader's eyes, and it announces the wrong language to a screen reader first.

`<html lang>` must follow a switch made *without* navigating, too. The package
carries the one effect that does it; everything else is server-resolved state.

Import the readers by their own subpaths — `@blackcode/platform-i18n/server`
(it pulls `next/headers`, which throws in a client component) and
`/client` (it carries `'use client'`). **The barrel is pure and must stay that
way.**

### `@blackcode/platform-ui` is still English-only

`ConfirmProvider` hardcodes `'Cancel'`, `'Delete'` and `'Confirm'` as defaults.
On a French page the sign-out confirmation read *"Se déconnecter ? … **Cancel**
Se déconnecter"* until `apps/books` started passing `cancelLabel` explicitly.

**Every option is overridable, so a caller can be correct today** — pass
`cancelLabel` and `confirmLabel` whenever your app has a locale. The package
itself is unfixed: whether a UI package may depend on `platform-i18n` is a
decision nobody has taken, and the next app to translate hits the same defaults.

---

## Components

### `components/ui/` — primitives

shadcn-style: `button`, `input`, `label`, `card`, `badge`, `alert`, `accordion`,
`tabs`, `separator`. Plus the **bespoke shared primitives** below.

Feature components — listings, kanban boards, detail views, modals — belong to
the app that owns them and are documented there, not here.

## Shared design primitives

Use these instead of rolling new ones — they keep every surface (listings,
kanban, detail pages, modals) rendering work-item state identically.

- **`components/ui/work-item-icons.tsx`**
  - `StatusIcon({ status, size? })` — backlog dashed circle · todo/planned empty
    circle · in_progress yellow half-pie · done/completed indigo check ·
    cancelled gray ✕.
  - `PriorityIcon({ priority, size? })` with `issuePriorityKey(1..5)` /
    `projectPriorityKey('P0'..'P4')` → urgent ! square · high/medium/low signal
    bars · none dashes.
  - `HealthIcon({ status, size? })` — project update health sparkline:
    `on_track` green rising · `at_risk` amber wavy · `off_track` red falling ·
    `null` dashed "no updates".
  - `ProgressRing({ pct, size?, color? })` — circular percent ring.
- **`components/ui/member-avatar.tsx`** — `MemberAvatar({ name, email,
  avatarUrl, size? })`; image when present, else initials on a deterministic
  hashed color.
- **`components/ui/google-mark.tsx`** — `GoogleMark({ size? })`: the Google "G"
  for a "Continue with Google" button, inline SVG on a white tile so it survives
  dark mode. It lives here rather than in an app because both apps draw it and
  because its four hexes are a third party's brand, not app palette — which is
  what lets `apps/sales` use it without tripping `lib/palette.test.ts` (D-4:
  every colour that app renders is decided in `lib/pipeline.ts`). Read the
  file's header before moving it.
- **`components/ui/multi-assignee-select.tsx`** — `MultiAssigneeSelect({ assignees, members, onChange, compact?, align? })`. Multi-select assignee picker that renders stacked `MemberAvatar`s (up to 2, then "+N") and a searchable checkbox dropdown. `onChange` receives the full `number[]` of selected user IDs. Use `compact` mode for tight list rows. Replaces the old single-value `PropertySelect` for assignees everywhere.
- **`components/ui/property-select.tsx`** — `PropertySelect` quiet chip-button
  opening a searchable, keyboard-navigable popover. Replaces native `<select>`
  in detail sidebars and create modals. Options take an optional `icon`.
- **`components/ui/date-picker.tsx`** — `DatePicker({ value, onChange,
  variant: 'chip' | 'inline', label?, align? })`. `value` is a `yyyy-MM-dd`
  string (tolerates ISO); timezone-safe (parsed as a local day). Calendar
  popover; replaces all native `<input type="date">`.
- **`components/ui/confirm-dialog.tsx`** — `ConfirmProvider` + `useConfirm()`:
  `confirm(opts) → Promise<boolean>` and `prompt(opts) → Promise<string|null>`
  (supports `requireMatch` for type-to-confirm deletes). Use this instead of
  `window.confirm/alert/prompt`.
- **`components/ui/delete-with-children-dialog.tsx`** — `DeleteDialogProvider` +
  `useDeleteDialog()`: `confirmDelete(opts) → Promise<{mode:'cascade'|'detach'}|null>`.
  Used when deleting a project or task — fetches live child counts from
  `?preview=1` and shows a cascade-vs-detach toggle before confirming. Wrap the
  app in `<DeleteDialogProvider>` (done in `app/providers.tsx`).
- **`components/ui/restore-conflict-dialog.tsx`** — controlled dialog rendered by
  `trash-view.tsx` when a dry-run restore returns conflicts. Shows per-item
  `restore_parent` / `standalone` choice; calls `onConfirm(resolutions)`.
- **`components/ui/modal.tsx`** — `Modal` overlay (backdrop blur, animate-in,
  ESC/overlay close, scroll lock).
- **`@blackcode/platform-ui/rich-text-editor`** (`packages/platform-ui/src/rich-text-editor.tsx`) — TipTap.
  - `RichTextEditor({ content, onChange, placeholder?, editable?, onFileUpload?,
    hideToolbar?, minHeight?, variant: 'bordered' | 'seamless', mentionItems?,
    onBlur? })`. `seamless` is for always-editable detail-page bodies; `bordered`
    for modals/composers. A **bubble menu** appears on selection and a **floating
    menu** on empty lines. Passing `mentionItems` (`{ id, label, avatarUrl? }[]`)
    enables `@mentions` (tippy dropdown; the `.mention` chip styles it).
  - **Tables** — TipTap `Table/TableRow/TableHeader/TableCell` are wired into
    **both** the editing editor and `RichTextDisplay`. Insert via the `/table`
    slash command (3×3 with a header row); a **table bubble menu** (cursor in a
    table, no text selection) adds/deletes rows & columns, toggles the header
    row, and deletes the table. Columns are resizable in the editor. gfm
    Markdown tables and pasted/POSTed HTML tables parse into the same node, so
    tables authored from the CLI/API render identically. Styling lives in
    `app/globals.css` under `.prose table` (fixed layout, horizontal scroll on
    narrow viewports). Storage-safe because both the server sanitizer
    (`lib/rich-text.ts`) and the render-layer DOMPurify whitelist the table
    markup (incl. `colgroup/col`, `colspan/rowspan`).
  - **Native media** — a raw HTML5 `<video>`/`<audio>` tag pointing at an
    **uploaded** asset is rewritten server-side into the inline player (same as a
    drag-drop upload); external media and `<iframe>` embeds are still stripped on
    render (security). Embed external media by uploading it via `/api/upload`.
  - **Voice notes** — when `onFileUpload` is set, users can record audio inline
    via the `/voice note` slash command, the toolbar mic button, or the
    **⌘⇧M / Ctrl+Shift+M** shortcut (`buildVoiceShortcut`). The empty-editor
    placeholder advertises the shortcut alongside the `/` and `@` hints
    (`components/voice-recorder-modal.tsx`, `MediaRecorder` + `getUserMedia`). The
    modal handles mic-permission/secure-context failures with guidance, lets the
    user preview/re-record, then hands the recording to the **same**
    `uploadWithPlaceholder` path as any other attachment — it lands as a standard
    `audio/*` file-attachment (no new node type, no backend changes). webm/opus on
    Chrome·Firefox, mp4 on Safari.
  - `RichTextDisplay({ content })` — read-only render.
  - `MentionItem` — the mention item type.
  - **Sanitization on render.** Both the editable `RichTextEditor` and
    `RichTextDisplay` pass stored HTML through `sanitizeRichText()` (one shared
    helper, DOMPurify) before handing it to TipTap. The editable one matters
    because issue/task/project **descriptions** are rendered through it, not
    through `RichTextDisplay` — it previously took `content` raw. `ADD_ATTR`
    keeps the `data-*` TipTap needs to rebuild its nodes (file attachments,
    mentions, task items) plus table geometry; add to that list when adding an
    extension whose markup lives in attributes. This is defence in depth — the
    server sanitizes on write in `lib/rich-text.ts` — and it also covers rows
    written before server-side sanitization applied to the HTML path.

## The left menu — one sidebar in every app

Since 2026-09-28 every app's signed-in sidebar is built from
`@blackcode/platform-ui/ui/sidebar`, at apps/issues' sizes: `SidebarBrand` (the
mark and the app word, linking home), the workspace switcher in a `px-3 py-3`
slot below it, `SidebarNavItem` rows (`text-sm`, `py-1.5`, 17px icons, optional
count or trailing badge), `SidebarSectionLabel` for a group heading, and
`SidebarAccount` as the footer — avatar, name and email, then an icon row: an
optional app extra (books' EN/FR), theme, account settings, sign out
(confirmed). Width is `w-60` everywhere (`lg:pl-60` / `lg:ml-60` on the
content). The workspace's own settings entry is labelled **Workspace
settings**. The package has no router: each app passes `next/link` as `link`.

## Workspace management — one experience in every app

**Since 2026-09-28 every app manages workspaces with the same screens**, from
`packages/platform-ui/src/workspace/`, imported as
`@blackcode/platform-ui/workspace/<file>` (the package's `./workspace/*`
export). Until then each app had drawn its own, and they had drifted exactly
where it mattered: one removed members and revoked invitations with no
confirmation, two confirmed a delete by the workspace's *name*, one had a link
to a list page instead of a switcher, one kept workspaces off screen entirely,
and the workspace's picture was drawn four different ways. The kit is lifted from `apps/billing`'s screens, which were the
most complete; the logo came from `apps/issues`.

| Export (file) | What it is |
|---|---|
| `WorkspaceSwitcher` (`workspace-switcher`) | The sidebar dropdown: the current workspace's mark, name and slug; every workspace with your role in it — or *"Owned by X"* for somebody else's, since *"Member"* cannot tell two "My Workspace"s apart; **Create workspace**; **Manage** the current one |
| `CreateWorkspaceModal` (`create-workspace-modal`) | A **name and nothing else**. The server derives the slug (which never changes), and a logo is set in settings once the workspace exists. `WORKSPACE_NAME_MAX` is 80 — every app's `workspaces.name` is `varchar(80)` |
| `WorkspaceChooser` (`workspace-chooser`) | `/dashboard` for somebody in several workspaces with nothing remembered. Choosing goes through the same `onSelect` as the switcher, so **the choice is remembered** — the sentence on screen says so, and routing the click through the callback is what makes it true |
| `InvitationCard` · `InvitationProblem` (`invitation-card`) | `/invitations/{token}`: accept/decline, or the reason the link cannot be used |
| `WorkspaceMark` (`workspace-mark`) | The logo, else the initial on a colour derived from the name — the same derivation `MemberAvatar` uses, so a workspace keeps its colour everywhere |
| `SettingsSection` + the sections below (`workspace-settings`) | The frame every settings card uses |
| `WorkspaceGeneralSection` | Name (editable by the owner), slug **read-only**, your role, and a logo row **only if the app passes `logo`** — an app with no logo column omits it |
| `WorkspaceMembersSection` | The member list; **make owner** and **remove**, both confirmed |
| `WorkspaceInvitationsSection` | Invite by address, colleague suggestions (`candidates`), the pending list with **copy link**, and **revoke**, confirmed |
| `WorkspaceLeaveSection` | A member's way out, confirmed |
| `WorkspaceDangerSection` | Delete, confirmed by **typing the slug** — or, when the app knows the workspace can never be deleted, a `refusal` rendered **instead of the button**, so an owner looking for "delete" learns why there is none rather than concluding it is missing |

**The contract — what makes one kit fit four apps:**

- **Presentational only.** The package has no router, no fetch and no toast
  library on purpose. Every action is a callback returning a promise: **resolve
  when it worked, throw when it did not**, and the app shows its own error in
  its own style. Data props are `undefined` while loading.
- **Every word is a `labels` prop.** `labels.ts` holds the English defaults and
  an app passes a `Partial<WorkspaceLabels>` merged over them. Anything with a
  name in it is a *function*, because French reorders the sentence around the
  name. A bilingual app builds the object from its own dictionary (`apps/books`
  passes EN/FR); product nouns ("invoices", "prospects") appear only in the
  `detail` strings an app supplies, never in the defaults. This is also why the
  kit does not trip a hardcoded-strings guard: it holds no copy an app cannot
  replace.
- **The `footer` props** are for each app's "same as `bk <app> …`" hint, which
  is app-specific by definition — and optional, since not every app puts
  commands in its copy.
- **Pages stay the app's.** The invitation page resolves the token on the
  server and decides, in one security order — accepted → not pending → expired
  → not yours — whether to render the card or the problem. The not-yours
  message names **only the signed-in address**, never the invitee's: a link is
  a bearer of nothing, and printing the address it was sent to turns it into an
  oracle.

**The shape every app follows:**

| Where | What |
|---|---|
| Sidebar | `WorkspaceSwitcher`. Selecting calls `POST /api/me/active-workspace` — the route `bk <app> workspace use` calls — then navigates |
| `/dashboard/{ws}/settings` | General · Members · Invitations (owner) · Leave (member) **or** Danger zone (owner) |
| `/dashboard` | One workspace → open it. Several → the remembered one, **if you are still a member of it**. Otherwise the shared chooser, which remembers |
| `/invitations/{token}` | `InvitationCard` / `InvitationProblem` |

Remembering is **per app**: each app stores the active workspace in its own
schema (`<app>.user_settings`) through its `setDefaultForUser`, because two
apps' workspace ids overlap. An app whose `setDefaultForUser` is a no-op makes
`POST /api/me/active-workspace` answer 200 and store nothing — which is how the
chooser and the switcher both came to promise a memory that did not exist in
two apps until 2026-09-28. Each app's doc says where its own is.

Adding an app: wire these, modelled on `apps/billing` (its
`components/shell/workspace-switcher.tsx`, `workspace-create-modal.tsx`,
`workspace-chooser.tsx`, `components/settings/workspace-settings.tsx` and
`accept-invitation.tsx` are the thinnest wiring of the four). See
[`adding-an-app.md`](./adding-an-app.md).

## Account settings — one set of tabs in every app

Since 2026-09-28 every app's `/dashboard/settings/*` is drawn from
`packages/platform-ui/src/account/` (`@blackcode/platform-ui/account/account-settings`
and `…/account/labels`). The account is one `platform.users` row everywhere,
so it is one page everywhere: **Profile · Account · API tokens · Preferences**,
same order, same cards, same `max-w-3xl` column.

| Export | What it draws |
|---|---|
| `AccountSettingsFrame` | The tab strip and column. `bare` when the shell already pads |
| `ProfileSection` | Photo (upload / remove), email as text, name, tagline |
| `SignedInSection` · `PasswordSection` | Sign-out; the app's own password flow behind a button (`children(close)`) |
| `TokensSection` | Mint, copy once, list, revoke (confirmed, naming the token). Revoking the token still on screen takes its secret off |
| `AppearanceSection` | Light / Dark / System via `next-themes` — the browser, never the account |

Same contract as the workspace kit: presentational, callbacks resolve on success
and **throw** on failure (the app shows its own toast), `link` is the app's
`next/link`. Each app keeps its own **Account** tab body (deletion rules differ
per app) inside `SettingsSection` cards.

**Words.** `labels` is a partial over English defaults, and the defaults carry
**no brand** — b/billing ships rebranded, and its brand-leak guard scans the
app, not this package. An app that wants its name in a sentence passes the
label. b/books builds the WHOLE `AccountLabels` from its EN/FR dictionary
(`components/settings/labels.ts`), typed total rather than partial, so a key
added to the kit and not translated is a `tsc` error instead of English on a
French page.

**The photo** goes through `POST/DELETE /api/me/avatar` (`meAvatarRoute` in
`platform-api`, mounted by every app; `bk profile avatar`), so an app with no
general upload route can still offer one. `platform.users.avatar_url` is in the
blob index since `apps/issues` migration 0050 — before it, nothing protected
an uploaded avatar from storage clean-up.

## Workspace-scoped URLs

All workspace content lives under **`/dashboard/{ws}/…`** where `{ws}` is the
workspace **slug**. Detail URLs use the workspace-scoped **#number (`seq`)**, not
the global id — so the URL matches the number shown in the UI:

```
/dashboard/{ws}                     workspace home (projects)
/dashboard/{ws}/issues/{seq}        issue detail
/dashboard/{ws}/tasks/{seq}         task detail
/dashboard/{ws}/projects/{seq}      project detail
/dashboard/{ws}/{labels|activity|analytics|trash}
/dashboard/{ws}/settings            workspace settings (every app — see above)
```

Unscoped (user/platform) routes stay flat — `/dashboard/settings/*` (your
account) and `/dashboard/super-admin/*` in every app; anything else unscoped is
an app's own and listed in its doc.

**URL is the source of truth for the active workspace.** `useActiveWorkspace()`
reads the `ws` route param (falling back to the user's remembered default on
unscoped pages). The `app/dashboard/[ws]/layout.tsx` server layout gates
membership (redirect to `/dashboard` if not a member) and `PersistActiveWorkspace`
records it as the default. The bare `/dashboard` resolves as in the table
under *Workspace management* above.

**The `{seq}` IS the id.** The API addresses projects/tasks/issues by the
workspace #number directly (the server resolves seq→internal id), so detail
pages just render the view with the seq — no preflight, no second id. The views
(`IssueDetailView` / `TaskDetailView` / `ProjectDetailView`) take the seq as
their `issueId`/`taskId`/`projectId` and an optional `workspaceSlug`, and fetch
`/api/workspaces/{ws}/{type}/{seq}` (+ sub-resources by the same seq). See
`docs/changelog/`.

There is **no legacy id mapping** — old global-id links are not redirected.

**Inbox** is cross-workspace: each message's `workspace_id` is passed as
`workspaceSlug`, and the entity's seq (`payload.entity_seq` / `payload.issue_seq`)
as the id, so previews open for items in any workspace with no workspace switch.
Invitation notifications (`entity_type === 'invitation'`) have no issue/project/task
to preview — the detail pane renders `InvitationDetail` instead, with inline
Accept/Decline when the invite is still pending (token from
`/api/me/pending-invitations`) and otherwise a link to `/invitations/[token]`
(the fanout payload carries `invitation_token`).

## State & data fetching

### TanStack Query

Configured in `providers.tsx` with `staleTime: 60s` and
`refetchOnWindowFocus: false`. The active workspace is resolved by
`components/listings/use-active-workspace.ts` (`['active-workspace']`), which
reads `/api/me` then `/api/workspaces`.

Recurring query-key conventions:

| Key | Scope |
|-----|-------|
| `['active-workspace']` | current workspace context |
| `['ws-projects-listing', slug, filters]`, `['ws-issues', slug, filters]`, `['ws-tasks-listing', slug, filters]` | listing pages |
| `['ws-members', slug]`, `['ws-projects', slug]`, `['ws-labels', slug]`, `['ws-tasks', slug]` | dropdown sources in modals |
| `['project', id, slug]`, `['issue', id]`, `['task', id, slug]` | detail pages |
| `['project-updates', id, slug]`, `['project-members', id]`, `['*-comments', id]` | detail sub-resources |
| `['inbox', unreadOnly]`, `['inbox-unread']` | inbox + badge |
| `['ws-activity', …]`, `['ws-analytics', …]` | activity / analytics |
| `['ws-trash', slug, type]` | trash (recycle bin) listing |
| `['workspace-members', slug]`, `['workspace-invitations', slug]` | settings |

After a mutation, invalidate both the detail key and the relevant listing key
(e.g. posting a project update invalidates `['project-updates', id]`,
`['project', id]`, and `['ws-projects-listing']` so the listing's health column
refreshes).

### Toasts

`import { toast } from 'sonner'`. Every mutating action should
`toast.success`/`toast.error`. Quiet autosaves (e.g. issue/project description)
deliberately skip success toasts and show an inline "Saving…" indicator instead.

## Conventions

- **Where things live:** primitives in `components/ui/`, feature components in
  `components/`, listing views in `components/listings/`, shared data helpers in
  `lib/`. Status/priority/health values + colors are canonical in
  `lib/work-items.ts` — never hard-code them.
- **Client vs server:** dashboard pages are thin server components that render a
  `'use client'` feature component which does the data fetching with TanStack
  Query.
- **Forms & mutations:** local `useState` for form fields → `useMutation` →
  `toast` on settle → `queryClient.invalidateQueries`. Use the shared
  `PropertySelect` / `DatePicker` / `RichTextEditor` rather than native inputs
  so the look stays consistent.
- **Page chrome:** in-app pages use a slim sticky header
  (`h-11 border-b bg-background/80 backdrop-blur`) and edge-to-edge borderless
  list rows (`px-6 hover:bg-secondary/40`) — no boxed `rounded-lg border` list
  containers. Detail pages are a centered `max-w-3xl` document column + a right
  properties sidebar of `PropertySelect` rows.
- **Confirmations:** use `useConfirm()`, never the native browser dialogs.

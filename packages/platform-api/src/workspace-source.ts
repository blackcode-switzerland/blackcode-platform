// WHERE AN APP'S WORKSPACES LIVE.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (multiAppFinalRefactor Phase 2, 2026-08-10)
// ---------------------------------------------------------------------------
// Until now there was one set of workspaces — `platform.workspaces` — and every
// shared route read it directly. That was the readable consequence of the
// misreading the refactor exists to undo: "an agent in sales can create an issue
// through the same CLI" was implemented as "the apps share their data", when it
// only ever needed one login and one binary.
//
// `apps/sales` now owns `sales.workspaces`. So the shared request layer can no
// longer name a table. This interface is the seam:
//
//   **the plumbing is shared, the DATA is not.**
//
// `apiHandler` still does the error envelope, the error log, the CLI version
// headers. `resolveWorkspace` still decides that a workspace you are not in is
// a 404 and not a 403. What it no longer decides is which table to look in.
//
// ---------------------------------------------------------------------------
// WHY IT IS REQUIRED ON `AppContext`, NOT OPTIONAL WITH A PLATFORM DEFAULT
// ---------------------------------------------------------------------------
// An optional field defaulting to `platform.workspaces` would mean the safe
// value is the one you have to remember to supply, and the failure would be
// SILENT: a new app that forgot it would serve, correctly, against another
// app's tenancy. That is `AppContext.resolveSessionUser`'s reasoning applied to
// a wider blast radius.
//
// Required means an app that has not answered "where do my workspaces live?"
// does not compile. `apps/issues` answers `platformWorkspaceSource(db)` — the
// same functions it always called, with the same arguments — so its behaviour is
// unchanged by construction rather than by review.
//
// ---------------------------------------------------------------------------
// WHY FIVE METHODS AND NOT ONE RESOLVER
// ---------------------------------------------------------------------------
// The obvious shape was `resolveWorkspace`, and it is not enough: several
// shared entry points read an app's tenancy tables, not one. `/api/meta`
// resolves a default workspace and lists members; `bk workspace use` writes
// one. A single resolver would have left every one of those still naming
// `platform.*` — a seam that looks finished and is not.
//
// Five methods over ONE subject — this app's workspaces and this caller's
// place in them — is a port, not a bag. The bar from `app-context.ts` still
// applies to each: a shared route cannot be written without it, and no app
// could supply a sensible default.
//
// It was SIX until 2026-08-11, and the sixth is the cautionary one. The
// paragraph above used to end "…; upload attribution reads one by id", which
// was `getById`'s entire justification — and Phase 3 moved upload attribution
// to `UploadLedger` without anyone noticing that the sentence, and the method,
// had outlived it. **The bar is not "was this justified when it was added"; it
// is "is the caller still there".** See the note where `getById` used to be.
//
// What is deliberately NOT here: creating a workspace, renaming one, deleting
// one, membership writes, and the whole invitation state machine. Those are an
// app's own routes. They carry an event spine, a cascade and a token lifecycle,
// and parameterising them would be inventing generality for one caller.

import {
  getUserById,
  getWorkspaceForUser,
  listMyWorkspaces,
  listWorkspaceMembers,
  setActiveWorkspace,
  type PlatformDb,
} from '@blackcode/platform-db'

/**
 * The columns every app's workspace table must have, because shared code reads
 * them.
 *
 * Deliberately five. `logo_url`, `storage_limit_bytes` and `deleted_at` are on
 * `platform.workspaces` and are NOT here: no shared route reads them, and
 * `sales.workspaces` does not carry them (migration 0003's header says why for
 * each). A field here is a field every future app must invent a value for.
 */
export interface WorkspaceRef {
  id: number
  name: string
  slug: string
  owner_id: number
  updated_at: Date
}

/** A workspace plus the caller's role in it. */
export interface WorkspaceMembershipRef extends WorkspaceRef {
  member_role: 'owner' | 'member'
}

/**
 * One row of a members listing, joined to the user record.
 *
 * `deleted_at` is carried rather than filtered, for the reason
 * `listWorkspaceMembers` states: a soft-deleted user who is still a member is a
 * row the UI must be able to render as such, and dropping them here would make
 * the member count disagree with the member list.
 */
export interface WorkspaceMemberRef {
  id: number
  workspace_id: number
  user_id: number
  role: string
  joined_at: Date
  email: string
  name: string | null
  avatar_url: string | null
  deleted_at: Date | null
}

export interface WorkspaceSource {
  /**
   * One workspace by slug or numeric id, asserting the caller is a member.
   *
   * Null when it does not exist OR the caller is not a member — the route layer
   * turns both into 404 so a workspace's existence does not leak. Do not split
   * those two cases in an implementation.
   */
  getForUser(slugOrId: string, userId: number): Promise<WorkspaceMembershipRef | null>

  /**
   * The workspaces this user belongs to, in this app.
   *
   * ── IT TOOK A `{ scopedToApp }` ARGUMENT UNTIL 2026-08-10 ──────────────────
   * True meant "the ones they can actually USE this app in" (narrowed by
   * `platform.app_access`), false the raw membership list that
   * `bk workspace list --all` existed to show. Phase 5 dropped the grants, so
   * the two answers became the same one for every app — `apps/sales` already
   * answered both identically, which was the early sign that the distinction
   * belonged to a shared workspace table rather than to this interface.
   */
  listForUser(userId: number): Promise<WorkspaceMembershipRef[]>

  // ── `getById` WAS HERE, AND ITS REMOVAL IS THE LESSON ──────────────────────
  // "One workspace by id with NO membership check. The caller is upload
  // attribution, resolving an id the user record already carries."
  //
  // That sentence stopped being true in Phase 3. Upload attribution moved to
  // `UploadLedger`, which resolves through the app's own ledger rather than
  // through a bare id read out of `platform.users.active_workspace_id` — and
  // `apps/sales/lib/db/queries/uploads.test.ts` asserts, by name, that this
  // method "must not be reached". So the ONE caller was deliberately severed,
  // the doc comment kept describing it, and three apps plus two fakes went on
  // implementing a method nobody called. Agents 4, 5 and 7 each flagged it;
  // agent 7 added a third implementation while flagging it.
  //
  // Deleted 2026-08-11 (Phase 8). **A required interface method with no caller
  // is not free.** Every app must invent an answer for it, which means every
  // app must decide what an unchecked cross-tenant lookup returns — a security
  // question asked of everyone and read by no one. If a future caller genuinely
  // needs a membership-free lookup, add it back WITH that caller in the same
  // commit, so the justification and the use arrive together.

  /** Everyone in one workspace. */
  listMembers(workspaceId: number): Promise<WorkspaceMemberRef[]>

  /**
   * Which workspace to assume when the caller named none — what `/api/meta`
   * reports as `active_workspace`.
   *
   * ── THIS IS NOT A CONVENIENCE. IT IS `error_events.workspace_id` AGAIN ──────
   * `platform.users.active_workspace_id` is ONE column shared by every app. It
   * worked while there was one set of workspaces; after the split, id 6 means a
   * different team depending on who wrote it, and `/api/meta`, upload
   * attribution and the issues dashboard all read it. An app that owns its
   * workspaces must NOT write its ids into that column, and must not read them
   * back out of it.
   */
  getDefaultForUser(userId: number): Promise<WorkspaceMembershipRef | null>

  /**
   * Remember the caller's default workspace. The write half of
   * `bk workspace use`.
   *
   * An app that shows no switcher and gives each person exactly one workspace
   * has nothing to remember, and implements this as a no-op — see the warning
   * on `getDefaultForUser` for why "just write the shared column" is the wrong
   * no-op.
   */
  setDefaultForUser(userId: number, workspaceId: number): Promise<void>
}

/**
 * The `platform.workspaces`-backed source — what `apps/issues` supplies.
 *
 * Every method is the platform-db function that route already called, with the
 * same arguments in the same order. That is the point: issues' behaviour is
 * unchanged by construction, not by review. If you find yourself adding logic
 * here, it belongs in platform-db beside the tables.
 *
 * It TOOK an `appSlug` until 2026-08-10, to scope the listing and the access
 * gate to the calling app. Both went with `platform.app_access` in Phase 5, and
 * nothing here is per-app any more — this table is `apps/issues`' own, so the
 * app is implied by the source you chose. The argument is dropped rather than
 * kept-and-ignored: a parameter every caller must supply and nobody reads is
 * the friendly shape of the problem CLAUDE.md is about.
 */
export function platformWorkspaceSource(db: PlatformDb): WorkspaceSource {
  return {
    getForUser: (slugOrId, userId) => getWorkspaceForUser(db, slugOrId, userId),

    listForUser: (userId) => listMyWorkspaces(db, userId),

    listMembers: (workspaceId) => listWorkspaceMembers(db, workspaceId),

    // Two lookups, deliberately: the caller's `User` may have been resolved from
    // a token minted before their last `bk workspace use`, and a stale default
    // is the one thing `/api/meta` must not report. `getWorkspaceForUser` then
    // re-checks membership, so a workspace they were removed from resolves to
    // null rather than to a workspace they cannot open.
    getDefaultForUser: async (userId) => {
      const fresh = await getUserById(db, userId)
      if (!fresh?.active_workspace_id) return null
      return getWorkspaceForUser(db, String(fresh.active_workspace_id), userId)
    },

    setDefaultForUser: (userId, workspaceId) => setActiveWorkspace(db, userId, workspaceId),
  }
}

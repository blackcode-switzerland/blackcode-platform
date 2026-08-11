// WHAT ONE APP HOLDS FOR ONE PERSON, AND HOW TO REMOVE IT.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (multiAppFinalRefactor Phase 9, 2026-08-11)
// ---------------------------------------------------------------------------
// Closing a blackcode account used to mean: soft-delete `platform.users`,
// hard-delete the workspaces in `platform.workspaces` they solely own, revoke
// their tokens. That was the whole operation while there was one set of
// workspaces. Since Phase 2 there is not, and the operation quietly stopped
// being what it said it was:
//
//   * The PREVIEW enumerated `platform.workspaces` — `apps/issues`' own table —
//     and named nothing else. Not empty: **confidently incomplete**.
//   * The DELETE then did not delete the rest either. `sales.workspaces.owner_id`
//     is `ON DELETE RESTRICT`, but the account close is an UPDATE setting
//     `deleted_at`, so the rule never fires. The sales workspace survived, owned
//     by an account that could no longer authenticate: not data lost, data
//     **STRANDED**, and unrecoverable by the person, because there was no
//     sign-in left to recover with.
//
// Measured in production on 2026-08-11 (PLAN.md §9 item 8). This interface is
// how an app answers both halves for itself.
//
// ---------------------------------------------------------------------------
// WHY AN APP MUST ANSWER, RATHER THAN THE PLATFORM ASKING THE DATABASE
// ---------------------------------------------------------------------------
// Because no deployment can read another app's tables. An app's Postgres role
// has no grant on another app's schema (docs/platform-architecture.md §4.3), so
// a central "what does this person hold everywhere?" query cannot be written —
// it is CLAUDE.md finding #14 exactly, the reconciler that could only ever see
// one deployment's data and reported a clean run over 51 unprojected rows.
//
// The alternatives were argued and lost; see ~/Documents/BAK/blackcode-platform-backups/multiAppFinalRefactor-correspondence/agent8's
// reply §2.5. The short version: a shared `platform.account_footprint` table is
// `platform.entities` again (a projection that drifts, needing a reconciler that
// cannot be written); a browser-side fan-out puts the census in the least
// trustworthy place and grows CORS on every app to serve a delete-account
// screen.
//
// ---------------------------------------------------------------------------
// READ AND PURGE ARE ONE PORT, DELIBERATELY
// ---------------------------------------------------------------------------
// They are the same subject asked twice — "what is mine here" and "remove what
// is mine here" — and splitting them is how an app implements the census and
// forgets the delete. An app that can be enumerated but not purged is the
// stranding bug with a better report.

/**
 * What one app holds for one person, in that app's own words.
 *
 * Every field is about THIS app. Nothing here may describe another one.
 */
export interface AppFootprint {
  /**
   * Whether this person is known to this app at all.
   *
   * "You have nothing here" and "you have never been here" are different
   * answers and the UI says so differently — the same distinction `/api/meta`'s
   * `workspaces: []` carries. Empty lists alone cannot express it.
   */
  known: boolean

  /**
   * Workspaces they own that OTHER PEOPLE ARE IN.
   *
   * These block, in this app and in the whole-account close. Deleting one would
   * take other people's data with it, so ownership has to be transferred first.
   * This is `deleteAccountReport`'s existing rule, extended rather than
   * replaced.
   */
  blocked_by: Array<{ workspace_id: number; name: string; member_count: number }>

  /** Workspaces they solely own — a purge destroys these and their content. */
  will_delete: Array<{ workspace_id: number; name: string }>

  /**
   * What is inside `will_delete`, in this app's own nouns: `prospects`,
   * `issues`, `meetings`. Counts, so a person recognises what they are about to
   * lose rather than being shown a number of workspaces.
   *
   * Free-form on purpose. The platform cannot know an app's nouns, and a fixed
   * vocabulary here would be the platform deciding what a future app is allowed
   * to hold. Empty is a legitimate answer.
   */
  holds: Array<{ label: string; count: number }>
}

/** An empty footprint for a person this app has never seen. */
export const UNKNOWN_FOOTPRINT: AppFootprint = {
  known: false,
  blocked_by: [],
  will_delete: [],
  holds: [],
}

export interface FootprintSource {
  /** What this app holds for this person. Reads only. */
  read(userId: number): Promise<AppFootprint>

  /**
   * Delete what this person owns in this app, and return WHAT IS LEFT.
   *
   * ── THE RETURN VALUE IS THE POINT ──────────────────────────────────────────
   * It returns a fresh footprint rather than `void` so the caller can ASSERT
   * the app is empty instead of assuming a 200 meant it. CLAUDE.md finding #16
   * is the reason: a check built on "did it refuse?" cannot tell a working
   * boundary from an absent subject, and the fix is to assert the positive.
   * The whole-account close reads this and refuses to touch `platform.users`
   * if any app still holds something.
   *
   * **It must never touch `platform.users`.** This is "my data in this app",
   * not "my account" — the account is the shared thing and closing it is a
   * separate, louder act. An implementation that soft-deleted the user here
   * would let any app close an account from a button that says something else.
   *
   * Must REFUSE (throw) while `blocked_by` is non-empty: a workspace with other
   * members in it survives, and that decision is not a per-app one.
   */
  purge(userId: number): Promise<AppFootprint>
}

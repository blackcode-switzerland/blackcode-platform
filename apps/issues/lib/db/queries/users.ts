import { db } from '../client'
import {
  getUserByEmail as platformGetUserByEmail,
  getUserById as platformGetUserById,
  getVisibleUsers as platformGetVisibleUsers,
  touchLastLogin as platformTouchLastLogin,
  updateUserProfile as platformUpdateUserProfile,
  upsertUserFromOAuth as platformUpsertUserFromOAuth,
  type UpdateUserProfileInput,
  type UpsertUserFromOAuthInput,
} from '@blackcode/platform-db'
import { users } from '../schema'
import type { User } from '../schema'

// DEPRECATED: returns every user on the platform. Do not expose to end users —
// it leaks the global directory. Use getVisibleUsers(callerId) instead. Kept
// only for internal/admin tooling that genuinely needs the full list.
export async function getUsers() {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatar_url: users.avatar_url,
    })
    .from(users)
    .orderBy(users.name)
}

// Privacy guard: the directory a given user is allowed to see. Returns only
// non-deleted users who share at least one workspace with the caller (which
// includes the caller themselves). This is the professional model — you can
// only discover people you already collaborate with. Inviting brand-new people
// is done blind, by email.
// Moved to @blackcode/platform-db on 2026-08-06 with GET /api/users, which is
// now a shared route factory (docs/sales-app-plan.md Phase 1b). It reads only
// platform.users and platform.workspace_members. Bound to this app's `db` here
// so every existing call site is unchanged.
export function getVisibleUsers(callerId: number) {
  return platformGetVisibleUsers(db, callerId)
}

// The sign-in callbacks moved to @blackcode/platform-db on 2026-08-06
// (docs/sales-app-plan.md Phase 1b-C). There is one login for every app — one
// `platform.users` row, one password, one Google identity — so "find this person
// by email" and "record that they just logged in" cannot belong to one of them.
// `authOptions` itself stays per-app; the reason is in
// packages/platform-auth/src/index.ts.
export function getUserByEmail(email: string): Promise<User | null> {
  return platformGetUserByEmail(db, email)
}

// Moved to @blackcode/platform-db on 2026-08-06 with /api/me, now a shared
// route factory (docs/sales-app-plan.md Phase 1b). One login serves every app,
// so an account read cannot belong to one of them.
export function getUserById(id: number): Promise<User | null> {
  return platformGetUserById(db, id)
}

export function upsertUserFromOAuth(
  data: UpsertUserFromOAuthInput
): Promise<{ user: User; was_new: boolean }> {
  return platformUpsertUserFromOAuth(db, data)
}

export async function createUserWithPassword(data: {
  email: string
  password_hash: string
  name?: string | null
}): Promise<User | null> {
  const [created] = await db
    .insert(users)
    .values({
      email: data.email,
      password_hash: data.password_hash,
      name: data.name ?? undefined,
      last_login: new Date(),
    })
    .returning()
  return created ?? null
}

export function touchLastLogin(id: number): Promise<void> {
  return platformTouchLastLogin(db, id)
}

// Account closure and profile edits moved to @blackcode/platform-db on
// 2026-08-06 with /api/me. Both touch only platform.* (users, api_tokens,
// inbox_messages, workspaces, workspace_members), and `softDeleteUser` keeps its
// single-transaction guarantee there.
//
// ── `deleteAccountReport` AND `softDeleteUser` WERE RE-EXPORTED HERE ────────
// Deleted 2026-08-11 (Phase 9). The 2026-08-06 move said "the app files
// re-export these bound to their own `db`, so every existing call site is
// unchanged" — and for these two there were no call sites left to keep
// unchanged, because the ROUTE moved to `packages/platform-api` in the same
// change and calls platform-db directly. Two years of this repo's lesson in
// four lines: `WorkspaceSource.getById`'s bar is "is the caller still there",
// and Phase 9 found the answer by trying to thread a new required `appSlug`
// argument through a wrapper nobody calls.
export type { UpdateUserProfileInput }

export function updateUserProfile(
  id: number,
  patch: UpdateUserProfileInput
): Promise<User | null> {
  return platformUpdateUserProfile(db, id, patch)
}

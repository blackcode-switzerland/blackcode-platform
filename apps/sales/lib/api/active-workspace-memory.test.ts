// The switcher's memory, at the layer that decides where a person lands.
//
// ---------------------------------------------------------------------------
// WHY THIS IS WORTH A FILE
// ---------------------------------------------------------------------------
// `setDefaultForUser` was a NO-OP in this app until 2026-08-11, on a premise
// that had quietly become false: one workspace per person, so nothing to
// remember. A person invited into somebody else's workspace has two — signing
// in mints their own before they can accept the invitation — and the sidebar
// switcher makes choosing between them a real action.
//
// A switcher whose choice is not persisted is worse than no switcher: it works
// for exactly one page load, and the next visit silently puts you back.
//
// ---------------------------------------------------------------------------
// THE MEMBERSHIP RE-CHECK IS THE PROPERTY, NOT THE STORAGE
// ---------------------------------------------------------------------------
// The stored value is a workspace id. The foreign key guarantees the workspace
// still EXISTS; it cannot express "and they are still in it". So somebody
// removed from a shared workspace would keep being sent to it — a 404 with the
// sidebar still naming it — unless the reader resolves the pointer through the
// membership list. That is what these tests are mostly about.

import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/unused'
  process.env.PLATFORM_DB_DRIVER = 'pg'
})

// THE REAL FUNCTION, not a copy of it. The first draft of this file
// reimplemented the resolution here and asserted on the reimplementation —
// which would have stayed green whatever `workspaces.ts` did. The decision was
// extracted into a pure export precisely so this import is possible.
import { resolveActiveWorkspace } from '@/lib/db/queries/workspaces'

const OWN = { id: 1, name: 'Mine', slug: 'mine', owner_id: 7, updated_at: new Date(1), member_role: 'owner' as const }
const SHARED = { id: 2, name: 'Acme', slug: 'acme', owner_id: 9, updated_at: new Date(2), member_role: 'member' as const }

describe('the remembered workspace', () => {
  // POSITIVE CASE FIRST (CLAUDE.md finding #16): a stored choice must be
  // honoured. A guard built only on the refusals cannot tell a working memory
  // from one that never returns anything.
  it('returns the workspace the person chose', () => {
    expect(resolveActiveWorkspace([OWN, SHARED], 2)).toEqual(SHARED)
  })

  it('falls back to the first membership when nothing is stored', () => {

    // The FIRST, not the last. `listWorkspacesForUser` is oldest-first and a
    // person's own workspace is minted at sign-in, before any invitation can be
    // accepted — so the first is theirs. The previous implementation took the
    // last, which now means "the most recently updated workspace somebody else
    // owns".
    expect(resolveActiveWorkspace([OWN, SHARED], null)).toEqual(OWN)
  })

  // THE ONE THAT MATTERS.
  it('ignores a pointer at a workspace the person is no longer in', () => {
    // Removed from SHARED, but the pointer still names it.
    const got = resolveActiveWorkspace([OWN], 2)
    expect(got).toEqual(OWN)
    expect(got).not.toEqual(SHARED)
  })

  it('returns null for a person with no workspaces at all', () => {
    expect(resolveActiveWorkspace([], 2)).toBeNull()
  })
})

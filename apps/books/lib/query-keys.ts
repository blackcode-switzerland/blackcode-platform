// The cache key shape, and the one place it is built.
//
// ===========================================================================
// THE WORST BUG THIS APP CAN SHIP IS ONE BOOK'S NUMBERS UNDER ANOTHER'S NAME
// ===========================================================================
// Almost every read in b/books is scoped by two things no other app on this
// platform has: which BOOK (`entity`) and which FISCAL YEAR (`exercice`). A key
// that omits either one is not slow or stale — it is a balance sheet showing the
// wrong company's assets, with the right company's name in the header, and
// nothing on the page to say so.
//
// `booksFrontend/01-foundation.md` §1 settles the shape:
//
//     ['books', resource, { entity, exercice, ...filters }]
//
// and this module is the only place it is spelled. `lib/query-keys.test.ts`
// asserts BOTH halves of that: that the function separates scopes, and that no
// hook builds a key without it. The second half is the one that matters — a
// correct key builder nobody calls protects nothing.
//
// ── TWO SPELLINGS, BECAUSE "UNSCOPED" HAS TO BE SAID OUT LOUD ──────────────
// `GET /api/meta` and `GET /api/me` are genuinely not per-book. If the scoped
// builder simply tolerated a null entity, "this resource has no book" and "I
// forgot the book" would be the same call. They are different spellings instead:
//
//     booksKey('bilan', scope)      the entity and exercice are IN the key
//     booksGlobalKey('meta')        this resource has no book, deliberately
//
// A reviewer can then see which one a hook chose. That is the whole reason the
// second function exists — it is not a convenience.

/**
 * Which book, and which fiscal year.
 *
 * Both are nullable because the URL is the source of truth and a page can render
 * before `/api/meta` has said which books exist. **A null entity still goes into
 * the key**: the "no book chosen yet" result and the "book `aios`" result are
 * different results and must not share a cache slot.
 */
export interface Scope {
  entity: string | null
  exercice: number | null
}

/** The prefix every key in this app starts with. Namespaces the whole cache. */
export const BOOKS_KEY_ROOT = 'books' as const

/**
 * A read that belongs to one book and one fiscal year.
 *
 * `filters` is merged into the same object rather than appended as a third
 * element, so `{entity, exercice, account: '1020'}` is one flat scope a reader
 * can see at a glance — and so adding a filter to a hook cannot accidentally
 * produce a key that is a PREFIX of the unfiltered one (TanStack Query treats
 * key prefixes as a match for invalidation, which would then invalidate more
 * than intended, or less, depending on which way round it happened).
 */
export function booksKey(
  resource: string,
  scope: Scope,
  filters?: Record<string, string | number | boolean | null | undefined>
): readonly unknown[] {
  return [
    BOOKS_KEY_ROOT,
    resource,
    { entity: scope.entity, exercice: scope.exercice, ...(filters ?? {}) },
  ]
}

/**
 * A read that is the same whichever book you are looking at.
 *
 * Only two things qualify today — the meta payload and the signed-in account —
 * and both are genuinely global: `/api/meta` serves every book at once, and
 * `platform.users` is one row across every workspace and every app.
 *
 * **If you are reaching for this for anything else, you are probably about to
 * ship the bug at the top of this file.** Ask whether two books would answer
 * differently; if they would, it is `booksKey`.
 */
export function booksGlobalKey(
  resource: string,
  filters?: Record<string, string | number | boolean | null | undefined>
): readonly unknown[] {
  return [BOOKS_KEY_ROOT, resource, { ...(filters ?? {}) }]
}

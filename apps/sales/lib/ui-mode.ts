'use client'

// D-7's affordance switch, on the browser's side.
//
// ===========================================================================
// NOTHING IN THIS MODULE IS A PERMISSION, AND `lib/ui-mode.test.ts` IS WHY IT
// STAYS THAT WAY
// ===========================================================================
// `read_only` means the web app renders no mutation affordances. It does NOT
// mean the API refuses writes. Authorisation is workspace MEMBERSHIP and the
// workspace role (it was `platform.app_access` and the role until that table was
// dropped on 2026-08-10); anybody who can open this app can write through `bk`
// in either mode, and the server never asks what this module thinks.
//
// A toggle that LOOKS like a permission, is enforced only in React, and lives on
// the user's own settings page is a control nobody has watched fail and that
// anybody can turn off — CLAUDE.md's standing rule is written for exactly that
// shape. So the guard is structural: **`lib/ui-mode.test.ts` asserts that no
// server module imports this file, directly or transitively.** The day a route
// handler reads `useCanWrite`, the suite says so by name.
//
// That is also why the VALUES are not here. `UI_MODES`, `UI_MODE_VALUES` and
// `UI_MODE_DEFAULT` live in `lib/pipeline.ts` with every other vocabulary,
// because the route that validates a PATCH genuinely needs them — and a guard
// that forbids importing a module which contains something legitimate is a guard
// that gets weakened (D-37). There is nothing in here a server module has any
// reason to want.
//
// ===========================================================================
// THE DEFAULT WHILE LOADING IS read-only, AND THAT IS THE THIRD MITIGATION
// ===========================================================================
// Before the preference has arrived, `useCanWrite()` is false. The failure modes
// are not symmetric: defaulting the other way flashes edit buttons at somebody
// who set `read_only`, and a click that lands in that flash is a write they did
// not intend. Defaulting to false costs a few hundred milliseconds of a page
// that looks like what it is by default anyway.
//
// A failed fetch is the same answer for the same reason. It is not silent — the
// Settings page renders the error — but the affordances stay hidden.

import { useQuery } from '@tanstack/react-query'
import { apiGet, wsPath } from '@/lib/client'
import { UI_MODE_DEFAULT, UI_MODE_FULL } from '@/lib/pipeline'

export interface UiPreferences {
  ui_mode: string
  default_filters: unknown
  updated_at: string | null
}

/** The caller's preferences for one workspace. */
export function useUiPreferences(ws: string) {
  return useQuery({
    queryKey: ['preferences', ws],
    queryFn: () => apiGet<UiPreferences>(wsPath(ws, '/preferences')),
    // A display preference does not change under you, and re-fetching it on
    // every window focus would make edit controls appear and disappear while
    // somebody is typing in a form they opened.
    staleTime: 5 * 60_000,
  })
}

/** `read_only` | `full`, defaulting to the honest one until it is known. */
export function useUiMode(ws: string): string {
  return useUiPreferences(ws).data?.ui_mode ?? UI_MODE_DEFAULT
}

/**
 * Should this surface render editing at all?
 *
 * The one question every component asks, so that a third mode is one edit here
 * rather than a search for every comparison — and the comparison is against
 * `UI_MODE_FULL`, not "not the default", so a mode nobody has taught this
 * function about renders nothing rather than everything.
 */
export function useCanWrite(ws: string): boolean {
  return useUiMode(ws) === UI_MODE_FULL
}

/**
 * What a component says where it has hidden something.
 *
 * A control that is simply absent teaches nothing — the reader concludes the
 * feature does not exist, or that they are not allowed. Naming the command is
 * what makes read-only a mode rather than a wall, and it is the same answer the
 * catalog gives permanently (§4a of agent7's brief): *"maintained through
 * `bk sales …`"*.
 */
export const READ_ONLY_NOTE = 'Read-only mode. Editing here is hidden — write with `bk sales`.'

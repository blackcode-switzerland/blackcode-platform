// The Google "G", inline.
//
// ---------------------------------------------------------------------------
// WHY THIS IS IN THE SHARED PACKAGE AND NOT IN THE APP THAT NEEDED IT
// ---------------------------------------------------------------------------
// Two reasons, and the second is the load-bearing one.
//
//   1. Both apps offer "Continue with Google" from the same two environment
//      variables, so both need the mark. `apps/issues/app/login/page.tsx` has
//      carried a private copy since long before this package existed; a second
//      private copy in `apps/sales` would have been the third drawing of one
//      third-party asset in a repo that spent a week deleting duplicates.
//
//   2. **`apps/sales/lib/palette.test.ts` bans a literal hex under that app's
//      `components/` and `lib/`** — D-4, sales must not feel like issues, and
//      every colour it renders is decided in `lib/pipeline.ts`. The four hexes
//      below are Google's brand, not sales' palette, and they may not be
//      changed to fit a theme. Putting the mark HERE is not an evasion of that
//      guard: it is the honest statement that this is not app colour at all.
//      An allowance entry in the test naming a file would have been the
//      evasion, and that test's own header explains why (an allowance keeps
//      itself alive and can never go stale).
//
// ---------------------------------------------------------------------------
// DARK MODE
// ---------------------------------------------------------------------------
// The mark is multicolour and is specified for a light ground; the blue and the
// green both fail against a near-black button. It therefore renders on its own
// white tile rather than on the button's background, which is also how Google's
// own guidance draws it — the caller sizes the tile, this component draws only
// the glyph. `bg-white` is deliberate and not `bg-background`: this square must
// stay white in dark mode.

export function GoogleMark({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[3px] bg-white"
      style={{ width: size + 4, height: size + 4 }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
    </span>
  )
}

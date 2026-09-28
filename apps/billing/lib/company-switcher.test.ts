// `resolveCompanyLabel` — the pure part of `components/shell/company-switcher.tsx`.
//
// This app has no component-level test runner (no `.test.tsx` exists anywhere
// in the repo), so the rule "an unknown `?company=` slug is kept and rendered
// as 'no such company', never silently replaced" (ticket #79, books'
// `lib/scope.ts` pattern) is asserted here against the pure label function the
// component calls, rather than against the rendered tree.
//
// Watched fail 2026-09-28: reverting `resolveCompanyLabel` to the old
// `selected ? (current?.name ?? selected) : 'All companies'` shape made the
// "unknown slug" case below assert `{ label: 'typo', unknown: false }` against
// an expectation of `{ label: 'No such company', unknown: true }` — RED, on
// exactly the case the ticket exists to fix. Restored.

import { describe, it, expect } from 'vitest'
import { resolveCompanyLabel } from '@/components/shell/company-switcher'

describe('resolveCompanyLabel', () => {
  it('no ?company= at all reads as "All companies"', () => {
    expect(
      resolveCompanyLabel({ selected: null, current: undefined, isPending: false, isError: false })
    ).toEqual({ label: 'All companies', unknown: false })
  })

  it('a slug that matches a loaded company shows its name', () => {
    expect(
      resolveCompanyLabel({
        selected: 'acme',
        current: { name: 'Acme SA' },
        isPending: false,
        isError: false,
      })
    ).toEqual({ label: 'Acme SA', unknown: false })
  })

  // THE ONE THAT MATTERS. A slug the workspace does not have must be KEPT and
  // flagged, never silently replaced by "All companies" or another company's
  // record — that silent fallback is the exact bug the ticket calls "the worst
  // bug this app can ship".
  it('an unknown slug is kept and rendered as "no such company"', () => {
    expect(
      resolveCompanyLabel({ selected: 'typo', current: undefined, isPending: false, isError: false })
    ).toEqual({ label: 'No such company', unknown: true })
  })

  it('does not accuse the slug while the company list is still loading', () => {
    expect(
      resolveCompanyLabel({ selected: 'acme', current: undefined, isPending: true, isError: false })
    ).toEqual({ label: 'acme', unknown: false })
  })

  it('does not accuse the slug when the company list failed to load', () => {
    expect(
      resolveCompanyLabel({ selected: 'acme', current: undefined, isPending: false, isError: true })
    ).toEqual({ label: 'acme', unknown: false })
  })
})

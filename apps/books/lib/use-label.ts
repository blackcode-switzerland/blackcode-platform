'use client'

// `useLabel()` — the reader's side of a `{fr, en}` pair, in a component.
//
// A one-line wrapper over `pick()` from `lib/label.ts`, for the same reason
// `lib/i18n.tsx` wraps `useTranslate`: the hook is where the locale is, and
// putting it in `label.ts` would make that module client-only. `pick()` stays
// callable from a server component, a `useMemo` and a test.
//
// **This is not `t()`.** `t()` resolves one of OUR strings from the dictionary;
// this resolves one of the SERVER's, which arrives already carrying both
// languages. The two never overlap: nothing the backend sends is in the
// dictionary, and nothing in the dictionary comes off the wire.

import { useCallback } from 'react'
import { pick } from './label'
import { useLocale } from './i18n'
import type { StatementLabel } from './statements'

export function useLabel(): (label: StatementLabel | null | undefined) => string {
  const locale = useLocale()
  return useCallback((label) => pick(locale, label), [locale])
}

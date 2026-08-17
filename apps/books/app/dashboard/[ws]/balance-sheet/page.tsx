'use client'

// Balance sheet — **the legal structure, rendered, with no amounts.**
//
// ===========================================================================
// WHY THIS PAGE HAS CONTENT WHEN THE OTHER SIX PLACEHOLDERS DO NOT
// ===========================================================================
// `01-foundation.md` §6 says `<StatementTable>` is "renderable against
// `/api/meta` alone", and it is: the route serves `statements.bilan`, the art.
// 959a group and line structure in the article's order, because
// `lib/statements.ts` is a code constant rather than data. So the one thing
// sprint 1 can honestly put on this page is the document's SHAPE.
//
// That is not filler. It is the check that the shared component renders the real
// legal structure — every group, every line, in order — before thirteen screens
// are written on top of it, and it is what `01-foundation.md` §5 means by "a
// book with no entries is not an empty screen: the legal line list is fixed and
// a zero line is shown, never dropped".
//
// ===========================================================================
// THE AMOUNTS ARE `null`, WHICH IS NOT ZERO, AND THE DIFFERENCE IS THE POINT
// ===========================================================================
// §5 asks a book with no entries to render its lines at ZERO. That is right —
// and it is not this situation. **We do not know whether this book has entries.**
// There is no route that serves a derived bilan; it arrives with the backend's
// phase 1.
//
// So every line renders an em dash (`<Money value={null}>`), and the banner says
// why. Filling the column with `"0.00"` would have been one line of code and
// would have put a balance sheet on the screen claiming every account in the
// company is empty. In an accounting product that is not a placeholder, it is a
// false statement — and it is one nobody would notice was false, because a
// balance sheet of zeroes is exactly what a new company's looks like.
//
// **When the route lands, the amounts come from it and this banner goes.** The
// zero-lines rule then applies for real: a line the derivation returns as
// `"0.00"` renders as `0.00` and is never dropped.

import { useScope } from '@/lib/scope'
import { useParams } from 'next/navigation'
import { StatementTable, type StatementGroupView } from '@/components/statement-table'
import { ScreenFrame } from '@/components/screen-frame'

export default function Page() {
  const params = useParams<{ ws: string }>()
  const scope = useScope()
  const base = `/dashboard/${params.ws}`

  // Straight from `/api/meta` — the structure the SERVER serves, not a second
  // copy of `lib/statements.ts` imported into the bundle. A frontend that
  // imported the constant would keep rendering last week's legal structure after
  // the server's changed, with nothing to say so.
  const groups: StatementGroupView[] =
    scope.meta?.statements.bilan.map((g) => ({
      group: g.group,
      side: g.side as 'actif' | 'passif',
      lines: g.lines.map((l) => ({
        pos: l.pos,
        label: l.label,
        amount: null,
        related: l.related,
        derived: l.derived,
      })),
    })) ?? []

  return (
    <ScreenFrame title="Balance sheet">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-foreground">
          Bilan <span className="ml-2 text-sm font-normal text-muted-foreground">Balance sheet</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {scope.record?.name} · exercice {scope.exercice} · art. 959a CO
        </p>
      </div>

      <p className="mb-5 rounded-md border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Structure only.</span> This is the statutory
        line list in its legal order. There is no route serving derived amounts yet, so every line
        shows an em dash — <span className="font-semibold">not a zero</span>, because &ldquo;we do
        not know&rdquo; and &ldquo;it is nothing&rdquo; are different facts. The actif = passif check
        arrives with the amounts.
      </p>

      <StatementTable groups={groups} base={base} scope={scope} />
    </ScreenFrame>
  )
}

'use client'

// Minimal test UI — the overview. `GET …/overview`. See lib/web.ts.
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { box, cell, ErrorLine, table, useLoad } from '@/components/min/ui'
import { call, wsApi } from '@/lib/web'
import type { Overview } from '@/types'

export default function OverviewPage() {
  const { ws } = useParams<{ ws: string }>()
  const { data, error } = useLoad(() => call<Overview>(wsApi(ws, '/overview')), [ws])
  return (
    <main style={box}>
      <h1>Overview</h1>
      <ErrorLine error={error} />
      {data && (
        <>
          <h2>Per currency</h2>
          {data.by_currency.length === 0 ? (
            <p data-testid="overview-empty">No invoices yet.</p>
          ) : (
            <table style={table} data-testid="overview-currencies">
              <thead>
                <tr>{['currency', 'invoices', 'outstanding', 'overdue', 'paid'].map((h) => <th key={h} style={cell}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {data.by_currency.map((c) => (
                  <tr key={c.currency} data-testid={`overview-${c.currency}`}>
                    <td style={cell}>{c.currency}</td>
                    <td style={cell}>{c.count}</td>
                    <td style={cell}>{c.outstanding}</td>
                    <td style={cell}>{c.overdue}</td>
                    <td style={cell}>{c.paid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h2>Needs action</h2>
          <ul data-testid="needs-action">
            {data.needs_action.map((i) => (
              <li key={i.seq}>
                <Link href={`/dashboard/${ws}/invoices/${i.seq}`}>{i.number}</Link> — {i.status}, {i.currency} {i.totals.total}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  )
}

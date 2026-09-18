'use client'

// Minimal test UI — the imported archive: list and import (paste the rows as
// JSON). `GET/POST …/history`.
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { box, cell, DoneLine, ErrorLine, table, useAction, useLoad } from '@/components/min/ui'
import { call, list, wsApi } from '@/lib/web'
import type { HistoryEntry, ImportHistoryResult } from '@/types'

export default function HistoryPage() {
  const { ws } = useParams<{ ws: string }>()
  const rows = useLoad(() => list<HistoryEntry>(wsApi(ws, '/history?limit=100')), [ws])
  const [json, setJson] = useState('[]')
  const act = useAction()

  const importRows = () =>
    act.run(async () => {
      let parsed: unknown
      try {
        parsed = JSON.parse(json)
      } catch {
        throw new Error('that is not JSON: paste an array of rows')
      }
      const r = await call<ImportHistoryResult>(wsApi(ws, '/history'), { method: 'POST', body: { rows: parsed } })
      await rows.reload()
      return `imported ${r.imported}`
    })

  return (
    <main style={box}>
      <h1>Imported history</h1>
      <ErrorLine error={rows.error} testId="load-error" />
      {rows.data && (rows.data.length === 0 ? (
        <p data-testid="history-empty">Nothing imported.</p>
      ) : (
        <table style={table} data-testid="history">
          <thead>
            <tr>{['#', 'issued', 'source', 'ref', 'number', 'company', 'client', 'total', 'status', 'pdf', 'flag'].map((h) => <th key={h} style={cell}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.data.map((h) => (
              <tr key={h.seq} data-testid={`history-row-${h.seq}`}>
                <td style={cell}>{h.seq}</td><td style={cell}>{h.issue_date}</td><td style={cell}>{h.source}</td>
                <td style={cell}>{h.source_ref}</td><td style={cell}>{h.number}</td><td style={cell}>{h.company}</td>
                <td style={cell}>{h.client_name}</td><td style={cell}>{h.currency} {h.total}</td><td style={cell}>{h.status}</td>
                <td style={cell}>{h.drive_path ?? 'none'}</td><td style={cell}>{h.import_flag?.en ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}

      <h2>Import</h2>
      <p style={{ fontSize: 13 }}>An array of rows, as <code>bk billing history import --help</code> describes. All or nothing.</p>
      <textarea data-testid="input-rows" rows={8} cols={90} value={json} onChange={(e) => setJson(e.target.value)} />
      <br />
      <button type="button" data-testid="history-import" disabled={act.busy} onClick={() => void importRows()}>Import</button>
      <ErrorLine error={act.error} />
      <DoneLine done={act.done} />
    </main>
  )
}

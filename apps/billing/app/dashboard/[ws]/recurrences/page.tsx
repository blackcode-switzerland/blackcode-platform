'use client'

// Minimal test UI — recurring series: list (all or due) and create.
// `GET/POST …/recurrences`.
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import { box, cell, ErrorLine, Input, orNull, table, useAction, useForm, useLoad } from '@/components/min/ui'
import { call, list, wsApi } from '@/lib/web'
import type { Recurrence } from '@/types'

export default function RecurrencesPage() {
  const { ws } = useParams<{ ws: string }>()
  const router = useRouter()
  const [due, setDue] = useState(false)
  const series = useLoad(() => list<Recurrence>(wsApi(ws, `/recurrences?limit=100${due ? '&due=true' : ''}`)), [ws, due])
  const { form, set } = useForm({ template: '', frequency: 'monthly', start_date: '', occurrences_total: '', label_en: '' })
  const act = useAction()

  const create = () =>
    act.run(async () => {
      const r = await call<Recurrence>(wsApi(ws, '/recurrences'), {
        method: 'POST',
        body: {
          template: form.template.trim(),
          frequency: form.frequency,
          start_date: form.start_date.trim(),
          // Sent as typed, including empty: the server's "occurrences_required"
          // refusal is part of what a test should be able to see.
          occurrences_total: form.occurrences_total.trim() === '' ? undefined : Number(form.occurrences_total),
          label_en: orNull(form.label_en),
        },
      })
      router.push(`/dashboard/${ws}/recurrences/${r.seq}`)
    })

  return (
    <main style={box}>
      <h1>Recurring series</h1>
      <label style={{ fontSize: 13 }}>
        <input type="checkbox" data-testid="filter-due" checked={due} onChange={(e) => setDue(e.target.checked)} /> due only
      </label>
      <ErrorLine error={series.error} testId="load-error" />
      {series.data && (series.data.length === 0 ? (
        <p data-testid="series-empty">{due ? 'Nothing is due.' : 'No series.'}</p>
      ) : (
        <table style={table} data-testid="series">
          <thead>
            <tr>{['#', 'label', 'company', 'frequency', 'done', 'status', 'next', 'period', 'template'].map((h) => <th key={h} style={cell}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {series.data.map((r) => (
              <tr key={r.seq} data-testid={`series-row-${r.seq}`}>
                <td style={cell}><Link href={`/dashboard/${ws}/recurrences/${r.seq}`} data-testid={`series-link-${r.seq}`}>{r.seq}</Link></td>
                <td style={cell}>{r.label.en ?? r.label.fr ?? ''}</td>
                <td style={cell}>{r.company}</td>
                <td style={cell}>{r.frequency}</td>
                <td style={cell}>{r.occurrences_done}/{r.occurrences_total}</td>
                <td style={cell}>{r.status}{r.due ? ' (due)' : ''}</td>
                <td style={cell}>{r.next_date ?? '—'}</td>
                <td style={cell}>{r.next_period ?? '—'}</td>
                <td style={cell}>{r.template_number ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}

      <h2>New series</h2>
      <form data-testid="series-form" onSubmit={(e) => { e.preventDefault(); void create() }}>
        <Input label="template invoice" name="template" value={form.template} onChange={set} placeholder="#number or printed number" />
        <label style={{ display: 'block', margin: '4px 0', fontSize: 13 }}>
          <span style={{ display: 'inline-block', minWidth: 140 }}>frequency</span>
          <select name="frequency" data-testid="input-frequency" value={form.frequency} onChange={(e) => set('frequency', e.target.value)}>
            {['monthly', 'quarterly', 'yearly'].map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <Input label="start date" name="start_date" value={form.start_date} onChange={set} placeholder="YYYY-MM-DD" />
        <Input label="occurrences (required)" name="occurrences_total" value={form.occurrences_total} onChange={set} placeholder="12" />
        <Input label="label" name="label_en" value={form.label_en} onChange={set} />
        <button type="submit" disabled={act.busy} data-testid="series-create">Create series</button>
      </form>
      <ErrorLine error={act.error} />
    </main>
  )
}

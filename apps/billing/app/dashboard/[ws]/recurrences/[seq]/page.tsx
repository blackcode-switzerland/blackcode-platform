'use client'

// Minimal test UI — one series: where it stands, its invoices, generate,
// pause/resume, end early. `GET/PATCH …/recurrences/{seq}`,
// `POST …/recurrences/{seq}/generate`.
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { box, cell, DoneLine, ErrorLine, Input, orNull, table, useAction, useForm, useLoad } from '@/components/min/ui'
import { call, list, wsApi } from '@/lib/web'
import type { AuditEntry, GenerateOccurrenceResult, Recurrence } from '@/types'

export default function SeriesPage() {
  const { ws, seq } = useParams<{ ws: string; seq: string }>()
  const rec = useLoad(() => call<Recurrence>(wsApi(ws, `/recurrences/${seq}`)), [ws, seq])
  const audit = useLoad(() => list<AuditEntry>(wsApi(ws, `/audit?subject=recurrence:${seq}&limit=100`)), [ws, seq])
  const { form, set } = useForm({ period: '', message: '', occurrences_total: '' })
  const act = useAction()
  const r = rec.data
  const refresh = async (msg: string) => {
    await Promise.all([rec.reload(), audit.reload()])
    return msg
  }
  const patch = (body: unknown, msg: string) =>
    act.run(async () => {
      await call(wsApi(ws, `/recurrences/${seq}`), { method: 'PATCH', body })
      return refresh(msg)
    })

  return (
    <main style={box}>
      <p><Link href={`/dashboard/${ws}/recurrences`}>← series</Link></p>
      <ErrorLine error={rec.error} testId="load-error" />
      {r && (
        <>
          <h1>Series #{r.seq} {r.label.en ?? r.label.fr ?? ''}</h1>
          <table style={table} data-testid="series-fields">
            <tbody>
              {([
                ['status', r.status],
                ['company', r.company],
                ['frequency', `${r.frequency}, from ${r.start_date}`],
                ['done', `${r.occurrences_done}/${r.occurrences_total}`],
                ['next', r.next_date ? `${r.next_date} (period ${r.next_period})${r.due ? ' — due' : ''}` : 'complete'],
                ['template', r.template_number ?? '—'],
              ] as Array<[string, string]>).map(([k, v]) => (
                <tr key={k}><th style={cell}>{k}</th><td style={cell} data-testid={`field-${k}`}>{v}</td></tr>
              ))}
            </tbody>
          </table>

          <h2>Invoices</h2>
          <table style={table} data-testid="series-invoices">
            <tbody>
              {r.invoices?.map((i) => (
                <tr key={i.seq}>
                  <td style={cell}><Link href={`/dashboard/${ws}/invoices/${i.seq}`}>{i.number}</Link></td>
                  <td style={cell}>{i.occurrence_period ?? '(template)'}</td>
                  <td style={cell}>{i.issue_date}</td>
                  <td style={cell}>{i.status}</td>
                  <td style={cell}>{i.currency} {i.total}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Actions</h2>
          <ErrorLine error={act.error} />
          <DoneLine done={act.done} />
          {r.status !== 'completed' && (
            <fieldset style={{ marginBottom: 12 }}>
              <legend>Generate</legend>
              <Input label="period" name="period" value={form.period} onChange={set} placeholder={r.next_period ?? ''} />
              <Input label="payment message" name="message" value={form.message} onChange={set} placeholder="the template's" />
              <button
                type="button"
                data-testid="generate"
                onClick={() =>
                  act.run(async () => {
                    const g = await call<GenerateOccurrenceResult>(wsApi(ws, `/recurrences/${seq}/generate`), {
                      method: 'POST',
                      // The period is sent as typed, never filled in: the
                      // server refuses rather than guesses, and so does this.
                      body: { period: form.period.trim(), ...(form.message.trim() ? { message: form.message.trim() } : {}) },
                    })
                    return refresh(`created ${g.invoice.number}${g.replacement ? ' (replacement)' : ''}`)
                  })
                }
              >
                Generate draft
              </button>
            </fieldset>
          )}
          {r.status === 'active' && <button type="button" data-testid="pause" onClick={() => patch({ status: 'paused' }, 'paused')}>Pause</button>}
          {r.status === 'paused' && <button type="button" data-testid="resume" onClick={() => patch({ status: 'active' }, 'resumed')}>Resume</button>}
          {r.status !== 'completed' && (
            <fieldset style={{ marginTop: 12 }}>
              <legend>Occurrences</legend>
              <Input label="total" name="occurrences_total" value={form.occurrences_total} onChange={set} placeholder={String(r.occurrences_total)} />
              <button type="button" data-testid="edit-total" onClick={() => patch({ occurrences_total: Number(orNull(form.occurrences_total)) }, 'total saved')}>
                Save total
              </button>
            </fieldset>
          )}

          <h2>History</h2>
          <table style={table} data-testid="audit">
            <tbody>
              {audit.data?.map((a) => (
                <tr key={a.seq}>
                  <td style={cell}>{a.ts.slice(0, 19)}</td><td style={cell}>{a.action}</td><td style={cell}>{a.field ?? ''}</td>
                  <td style={cell}>{a.detail_en ?? `${a.from_value ?? ''} → ${a.to_value ?? ''}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  )
}

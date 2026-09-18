'use client'

// Minimal test UI — one invoice: its fields, lines, totals, the derived payment
// block, the issuer copy, its history, and every action `bk billing invoice`
// has: edit, lines, PDF, QR payload, send, mark-sent, paid, void.
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { box, cell, DoneLine, ErrorLine, Input, orNull, table, useAction, useForm, useLoad } from '@/components/min/ui'
import { parseLines } from '@/components/min/lines'
import { call, list, text, wsApi } from '@/lib/web'
import type { AuditEntry, Invoice } from '@/types'

export default function InvoicePage() {
  const { ws, ref } = useParams<{ ws: string; ref: string }>()
  const inv = useLoad(() => call<Invoice>(wsApi(ws, `/invoices/${encodeURIComponent(ref)}`)), [ws, ref])
  const audit = useLoad(() => list<AuditEntry>(wsApi(ws, `/audit?subject=invoice:${encodeURIComponent(ref)}&limit=100`)), [ws, ref])
  const act = useAction()
  const [qr, setQr] = useState<string | null>(null)
  const { form, set } = useForm({ message: '', due_date: '', client_name: '', lines: '', to: '', paid_date: '', reason: '', confirm: '' })

  const i = inv.data
  const path = (suffix = '') => wsApi(ws, `/invoices/${encodeURIComponent(ref)}${suffix}`)
  const after = (msg: string) => async () => {
    await Promise.all([inv.reload(), audit.reload()])
    return msg
  }
  const post = (suffix: string, body: unknown, msg: string) =>
    act.run(async () => {
      await call(path(suffix), { method: 'POST', body })
      return after(msg)()
    })
  const patch = (body: unknown, msg: string) =>
    act.run(async () => {
      await call(path(), { method: 'PATCH', body })
      return after(msg)()
    })

  return (
    <main style={box}>
      <p><Link href={`/dashboard/${ws}/invoices`}>← invoices</Link></p>
      <ErrorLine error={inv.error} testId="load-error" />
      {i && (
        <>
          <h1 data-testid="invoice-number">{i.number}</h1>
          <table style={table} data-testid="invoice-fields">
            <tbody>
              {([
                ['#', i.seq],
                ['status', i.status],
                ['company', i.company],
                ['client', [i.client.name, i.client.street, i.client.building, i.client.postal_code, i.client.city, i.client.country].filter(Boolean).join(', ')],
                ['issued', i.issue_date],
                ['due', i.due_date ?? '—'],
                ['paid', i.paid_date ?? '—'],
                ['currency', i.currency],
                ['language', i.language],
                ['reference', `${i.ref_type} ${i.derived.reference_formatted ?? '—'}`],
                ['pay to', i.derived.has_payment_part ? `${i.derived.account_formatted ?? '—'} ${i.derived.creditor.name}` : 'no payment part'],
                ['message', i.message ?? '—'],
                ['issuer', i.issuer ? `copied ${i.issuer.captured_at}${i.issuer.backfilled ? ' (backfilled)' : ''}` : 'live (draft)'],
                ['series', i.recurrence ? `#${i.recurrence} ${i.occurrence_period ?? '(template)'}` : '—'],
                ['sent', i.sent_at ? `${i.sent_at}${i.sent_message_id ? ` message ${i.sent_message_id}` : ' (outside this app)'}` : '—'],
                ['void', i.void ? `${i.void.ts} — ${i.void.reason.en}` : '—'],
              ] as Array<[string, string | number]>).map(([k, v]) => (
                <tr key={k}>
                  <th style={cell}>{k}</th>
                  <td style={cell} data-testid={`field-${k.replace(/\s+/g, '-')}`}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Lines</h2>
          <table style={table} data-testid="lines">
            <thead><tr>{['#', 'description', 'qty', 'unit', 'price', 'vat', 'total'].map((h) => <th key={h} style={cell}>{h}</th>)}</tr></thead>
            <tbody>
              {i.items.map((l) => (
                <tr key={l.line_no}>
                  <td style={cell}>{l.line_no}</td><td style={cell}>{l.description}</td><td style={cell}>{l.qty}</td>
                  <td style={cell}>{l.unit ?? ''}</td><td style={cell}>{l.unit_price}</td>
                  <td style={cell}>{l.vat_rate === null ? 'none' : `${l.vat_rate}%`}</td><td style={cell}>{l.line_total}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p data-testid="totals">
            subtotal {i.totals.subtotal} · VAT {i.totals.vat_total} · rounding {i.totals.rounding} ·{' '}
            <strong data-testid="total">total {i.currency} {i.totals.total}</strong>
          </p>

          {i.derived.problems.length > 0 && (
            <div data-testid="problems" style={{ border: '1px solid #a00', padding: 8 }}>
              <strong>Not a valid QR-bill yet — pdf, qr and send refuse:</strong>
              <ul>{i.derived.problems.map((p, n) => <li key={n} data-testid="problem">[{p.code}] {p.message} — {p.suggestion}</li>)}</ul>
            </div>
          )}

          <h2>Document</h2>
          <p>
            <a href={path('/pdf')} target="_blank" rel="noreferrer" data-testid="pdf-link">Open PDF</a>{' · '}
            <button type="button" data-testid="qr-show" onClick={() => act.run(async () => { setQr(await text(path('/qr'))) })}>Show QR payload</button>
          </p>
          {qr !== null && <pre data-testid="qr-payload" style={{ background: '#f4f4f4', padding: 8 }}>{qr}</pre>}

          <h2>Actions</h2>
          <ErrorLine error={act.error} />
          <DoneLine done={act.done} />

          <fieldset style={{ marginBottom: 12 }}>
            <legend>Edit</legend>
            <Input label="payment message" name="message" value={form.message} onChange={set} placeholder={i.message ?? ''} />
            <button type="button" data-testid="edit-message" onClick={() => patch({ message: orNull(form.message) }, 'message saved')}>Save message</button>
            <Input label="due date" name="due_date" value={form.due_date} onChange={set} placeholder={i.due_date ?? 'YYYY-MM-DD'} />
            <button type="button" data-testid="edit-due" onClick={() => patch({ due_date: form.due_date }, 'due date saved')}>Save due date</button>
            {i.status === 'draft' && (
              <>
                <Input label="client name" name="client_name" value={form.client_name} onChange={set} placeholder={i.client.name} />
                <button type="button" data-testid="edit-client" onClick={() => patch({ client: { ...i.client, name: form.client_name } }, 'client saved')}>Save client name</button>
                <label style={{ display: 'block', marginTop: 8, fontSize: 13 }}>
                  replace lines (description|qty|unit|price|vat)
                  <br />
                  <textarea data-testid="input-lines" rows={3} cols={70} value={form.lines} onChange={(e) => set('lines', e.target.value)} />
                </label>
                <button type="button" data-testid="edit-lines" onClick={() => patch({ items: parseLines(form.lines) }, 'lines replaced')}>Replace lines</button>
              </>
            )}
          </fieldset>

          {i.status === 'draft' && (
            <fieldset style={{ marginBottom: 12 }}>
              <legend>Issue</legend>
              <Input label="send to" name="to" value={form.to} onChange={set} placeholder="client@example.ch" />
              <button type="button" data-testid="send" onClick={() => post('/send', { to: form.to }, 'sent')}>Send by email</button>{' '}
              <button type="button" data-testid="mark-sent" onClick={() => post('/mark-sent', {}, 'marked sent')}>Mark sent (delivered elsewhere)</button>
            </fieldset>
          )}
          {i.status === 'sent' && (
            <fieldset style={{ marginBottom: 12 }}>
              <legend>Paid</legend>
              <Input label="paid on" name="paid_date" value={form.paid_date} onChange={set} placeholder="YYYY-MM-DD" />
              <button type="button" data-testid="mark-paid" onClick={() => post('/paid', { paid_date: form.paid_date }, 'marked paid')}>Mark paid</button>
            </fieldset>
          )}
          {i.status !== 'void' && (
            <fieldset style={{ marginBottom: 12 }}>
              <legend>Void</legend>
              <Input label="reason" name="reason" value={form.reason} onChange={set} />
              <Input label={`type ${i.number} to confirm`} name="confirm" value={form.confirm} onChange={set} />
              <button type="button" data-testid="void" onClick={() => post('/void', { reason_en: form.reason, confirm: form.confirm }, 'voided')}>Void</button>
            </fieldset>
          )}

          <h2>History</h2>
          <ErrorLine error={audit.error} testId="audit-error" />
          <table style={table} data-testid="audit">
            <tbody>
              {audit.data?.map((a) => (
                <tr key={a.seq}>
                  <td style={cell}>{a.ts.slice(0, 19)}</td><td style={cell}>{a.actor.email ?? '—'} ({a.actor.via})</td>
                  <td style={cell}>{a.action}</td><td style={cell}>{a.field ?? ''}</td><td style={cell}>{a.detail_en ?? `${a.from_value ?? ''} → ${a.to_value ?? ''}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  )
}

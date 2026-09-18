'use client'

// Minimal test UI — invoices: list, filter, create. `GET/POST …/invoices`.
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import { box, cell, ErrorLine, Input, orNull, table, useAction, useForm, useLoad } from '@/components/min/ui'
import { parseLines } from '@/components/min/lines'
import { call, list, wsApi } from '@/lib/web'
import type { Company, Invoice } from '@/types'

const EMPTY = {
  company: '', client_name: '', client_street: '', client_building: '', client_postal_code: '', client_city: '',
  client_country: 'CH', currency: '', ref_type: '', language: '', issue_date: '', message: '',
  lines: 'Work|1|h|100.00|8.10',
}

export default function InvoicesPage() {
  const { ws } = useParams<{ ws: string }>()
  const router = useRouter()
  const [status, setStatus] = useState('')
  const [company, setCompany] = useState('')
  const qs = new URLSearchParams({ limit: '100', ...(status ? { status } : {}), ...(company ? { company } : {}) })
  const invoices = useLoad(() => list<Invoice>(wsApi(ws, `/invoices?${qs}`)), [ws, status, company])
  const companies = useLoad(() => list<Company>(wsApi(ws, '/companies')), [ws])
  const { form, set } = useForm(EMPTY)
  const act = useAction()

  const create = () =>
    act.run(async () => {
      const inv = await call<Invoice>(wsApi(ws, '/invoices'), {
        method: 'POST',
        body: {
          company: form.company || companies.data?.[0]?.slug,
          client: {
            name: form.client_name.trim(), street: orNull(form.client_street), building: orNull(form.client_building),
            postal_code: orNull(form.client_postal_code), city: orNull(form.client_city), country: orNull(form.client_country),
          },
          items: parseLines(form.lines),
          currency: orNull(form.currency) ?? undefined,
          ref_type: orNull(form.ref_type) ?? undefined,
          language: orNull(form.language) ?? undefined,
          issue_date: orNull(form.issue_date) ?? undefined,
          message: orNull(form.message),
        },
      })
      router.push(`/dashboard/${ws}/invoices/${inv.seq}`)
    })

  return (
    <main style={box}>
      <h1>Invoices</h1>
      <div style={{ fontSize: 13 }}>
        status{' '}
        <select data-testid="filter-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {['', 'draft', 'sent', 'paid', 'void'].map((s) => <option key={s} value={s}>{s || 'all'}</option>)}
        </select>{' '}
        company{' '}
        <select data-testid="filter-company" value={company} onChange={(e) => setCompany(e.target.value)}>
          <option value="">all</option>
          {companies.data?.map((c) => <option key={c.slug} value={c.slug}>{c.slug}</option>)}
        </select>
      </div>
      <ErrorLine error={invoices.error} testId="load-error" />
      {invoices.data && (invoices.data.length === 0 ? (
        <p data-testid="invoices-empty">No invoices.</p>
      ) : (
        <table style={table} data-testid="invoices">
          <thead>
            <tr>{['#', 'number', 'company', 'client', 'issued', 'status', 'total', 'series'].map((h) => <th key={h} style={cell}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {invoices.data.map((i) => (
              <tr key={i.seq} data-testid={`invoice-row-${i.number}`}>
                <td style={cell}>{i.seq}</td>
                <td style={cell}><Link href={`/dashboard/${ws}/invoices/${i.seq}`} data-testid={`invoice-link-${i.number}`}>{i.number}</Link></td>
                <td style={cell}>{i.company}</td>
                <td style={cell}>{i.client.name}</td>
                <td style={cell}>{i.issue_date}</td>
                <td style={cell} data-testid={`invoice-status-${i.number}`}>{i.status}</td>
                <td style={cell}>{i.currency} {i.totals.total}</td>
                <td style={cell}>{i.recurrence ? `#${i.recurrence} ${i.occurrence_period ?? 'template'}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}

      <h2>New invoice</h2>
      <form data-testid="invoice-form" onSubmit={(e) => { e.preventDefault(); void create() }}>
        <label style={{ display: 'block', margin: '4px 0', fontSize: 13 }}>
          <span style={{ display: 'inline-block', minWidth: 140 }}>company</span>
          <select name="company" data-testid="input-company" value={form.company} onChange={(e) => set('company', e.target.value)}>
            {companies.data?.map((c) => <option key={c.slug} value={c.slug}>{c.slug}</option>)}
          </select>
        </label>
        <Input label="client name" name="client_name" value={form.client_name} onChange={set} />
        <Input label="client street" name="client_street" value={form.client_street} onChange={set} />
        <Input label="client building" name="client_building" value={form.client_building} onChange={set} />
        <Input label="client postal code" name="client_postal_code" value={form.client_postal_code} onChange={set} />
        <Input label="client city" name="client_city" value={form.client_city} onChange={set} />
        <Input label="client country" name="client_country" value={form.client_country} onChange={set} />
        <Input label="currency" name="currency" value={form.currency} onChange={set} placeholder="company default" />
        <Input label="reference type" name="ref_type" value={form.ref_type} onChange={set} placeholder="company default" />
        <Input label="language" name="language" value={form.language} onChange={set} placeholder="company default" />
        <Input label="issue date" name="issue_date" value={form.issue_date} onChange={set} placeholder="today" />
        <Input label="payment message" name="message" value={form.message} onChange={set} />
        <label style={{ display: 'block', margin: '4px 0', fontSize: 13 }}>
          <span style={{ display: 'block' }}>lines — one per row: description|qty|unit|price|vat (empty vat = no VAT)</span>
          <textarea name="lines" data-testid="input-lines" rows={4} cols={70} value={form.lines} onChange={(e) => set('lines', e.target.value)} />
        </label>
        <button type="submit" disabled={act.busy} data-testid="invoice-create">Create draft</button>
      </form>
      <ErrorLine error={act.error} />
    </main>
  )
}

'use client'

// Minimal test UI — companies: list and create. `GET/POST …/companies`.
import { useParams } from 'next/navigation'
import { box, cell, DoneLine, ErrorLine, Input, orNull, table, useAction, useForm, useLoad } from '@/components/min/ui'
import { call, list, wsApi } from '@/lib/web'
import type { Company } from '@/types'

const EMPTY = {
  slug: '', name: '', legal_name: '', street: '', building: '', postal_code: '', city: '', country: 'CH',
  email: '', iban: '', qr_iban: '', number_format: '', vat_registered: 'yes',
}

export default function CompaniesPage() {
  const { ws } = useParams<{ ws: string }>()
  const { data, error, reload } = useLoad(() => list<Company>(wsApi(ws, '/companies')), [ws])
  const { form, set, reset } = useForm(EMPTY)
  const act = useAction()

  const create = () =>
    act.run(async () => {
      const c = await call<Company>(wsApi(ws, '/companies'), {
        method: 'POST',
        body: {
          slug: form.slug.trim(),
          name: form.name.trim(),
          legal_name: orNull(form.legal_name) ?? undefined,
          address: {
            street: orNull(form.street), building: orNull(form.building), postal_code: orNull(form.postal_code),
            city: orNull(form.city), country: orNull(form.country),
          },
          email: orNull(form.email),
          iban: orNull(form.iban),
          qr_iban: orNull(form.qr_iban),
          number_format: orNull(form.number_format) ?? undefined,
          vat_registered: form.vat_registered === 'yes',
        },
      })
      reset()
      await reload()
      return `created company ${c.slug}`
    })

  return (
    <main style={box}>
      <h1>Companies</h1>
      <ErrorLine error={error} testId="load-error" />
      {data && (
        <table style={table} data-testid="companies">
          <thead>
            <tr>{['#', 'slug', 'name', 'legal name', 'city', 'iban', 'qr-iban', 'next no.'].map((h) => <th key={h} style={cell}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.seq} data-testid={`company-${c.slug}`}>
                <td style={cell}>{c.seq}</td>
                <td style={cell}>{c.slug}</td>
                <td style={cell}>{c.name}</td>
                <td style={cell}>{c.legal_name}</td>
                <td style={cell}>{c.address.city ?? '—'}</td>
                <td style={cell}>{c.iban ?? '—'}</td>
                <td style={cell}>{c.qr_iban ?? '—'}</td>
                <td style={cell}>{c.next_seq}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>New company</h2>
      <form data-testid="company-form" onSubmit={(e) => { e.preventDefault(); void create() }}>
        <Input label="slug" name="slug" value={form.slug} onChange={set} placeholder="acme" />
        <Input label="name" name="name" value={form.name} onChange={set} />
        <Input label="legal name" name="legal_name" value={form.legal_name} onChange={set} />
        <Input label="street" name="street" value={form.street} onChange={set} />
        <Input label="building" name="building" value={form.building} onChange={set} />
        <Input label="postal code" name="postal_code" value={form.postal_code} onChange={set} />
        <Input label="city" name="city" value={form.city} onChange={set} />
        <Input label="country" name="country" value={form.country} onChange={set} />
        <Input label="email" name="email" value={form.email} onChange={set} />
        <Input label="IBAN (owner only)" name="iban" value={form.iban} onChange={set} />
        <Input label="QR-IBAN (owner only)" name="qr_iban" value={form.qr_iban} onChange={set} />
        <Input label="number format" name="number_format" value={form.number_format} onChange={set} placeholder="AC-{SEQ4}" />
        <label style={{ display: 'block', margin: '4px 0', fontSize: 13 }}>
          <span style={{ display: 'inline-block', minWidth: 140 }}>VAT registered</span>
          <select name="vat_registered" data-testid="input-vat_registered" value={form.vat_registered} onChange={(e) => set('vat_registered', e.target.value)}>
            <option value="yes">yes</option>
            <option value="no">no</option>
          </select>
        </label>
        <button type="submit" disabled={act.busy} data-testid="company-create">Create company</button>
      </form>
      <ErrorLine error={act.error} />
      <DoneLine done={act.done} />
    </main>
  )
}

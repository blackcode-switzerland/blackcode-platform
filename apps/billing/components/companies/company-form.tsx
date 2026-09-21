'use client'

// The company form's fields — shared by the create dialog and the edit page.
// Only the caller decides what to DO with the state; this renders the sections
// and produces the two different bodies the routes want:
//
//   - `POST …/companies` takes NESTED `defaults: {…}` (CreateCompanyBody).
//   - `PATCH …/companies/{slug}` takes FLAT `default_currency`, … (EDITABLE in
//     lib/db/queries/companies.ts) — a different shape for the same values.
//
// `iban`/`qr_iban` are owner-only on BOTH routes: a member who sends the key at
// all gets a 403, whether or not the value changed, so `toEditPatch` omits them
// entirely rather than sending the field disabled-but-present.

import { useState } from 'react'
import { Input } from '@blackcode/platform-ui/ui/input'
import { FormField, FormGrid, Section, Select } from '@/components/ui-kit'
import {
  DOCUMENT_LANGUAGES,
  REFERENCE_TYPES,
  ROUNDING_POLICIES,
} from '@/lib/vocabularies'
import type { Company, CreateCompanyBody, DocumentLanguage, ReferenceType } from '@/types'

export interface CompanyFormState {
  slug: string
  name: string
  legal_name: string
  external_ref: string
  street: string
  building: string
  postal_code: string
  city: string
  country: string
  email: string
  iban: string
  qr_iban: string
  rounding: string
  vat_registered: boolean
  uid: string
  vat_number: string
  number_format: string
  default_currency: string
  default_language: string
  default_ref_type: string
  default_vat_rate: string
  default_prices_include_vat: boolean
  payment_terms_days: string
  footer_fr: string
  footer_en: string
}

const EMPTY: CompanyFormState = {
  slug: '',
  name: '',
  legal_name: '',
  external_ref: '',
  street: '',
  building: '',
  postal_code: '',
  city: '',
  country: 'CH',
  email: '',
  iban: '',
  qr_iban: '',
  rounding: 'line_0_05',
  vat_registered: true,
  uid: '',
  vat_number: '',
  number_format: '',
  default_currency: 'CHF',
  default_language: 'fr',
  default_ref_type: 'QRR',
  default_vat_rate: '',
  default_prices_include_vat: false,
  payment_terms_days: '30',
  footer_fr: '',
  footer_en: '',
}

const orNull = (v: string) => (v.trim() === '' ? null : v.trim())

/** Seed the form from an existing company, for the edit page. */
export function stateFromCompany(c: Company): CompanyFormState {
  return {
    slug: c.slug,
    name: c.name,
    legal_name: c.legal_name,
    external_ref: c.external_ref ?? '',
    street: c.address.street ?? '',
    building: c.address.building ?? '',
    postal_code: c.address.postal_code ?? '',
    city: c.address.city ?? '',
    country: c.address.country ?? '',
    email: c.email ?? '',
    iban: c.iban ?? '',
    qr_iban: c.qr_iban ?? '',
    rounding: c.rounding,
    vat_registered: c.vat_registered,
    uid: c.uid ?? '',
    vat_number: c.vat_number ?? '',
    number_format: c.number_format,
    default_currency: c.defaults.currency,
    default_language: c.defaults.language,
    default_ref_type: c.defaults.ref_type,
    default_vat_rate: c.defaults.vat_rate ?? '',
    default_prices_include_vat: c.defaults.prices_include_vat,
    payment_terms_days: String(c.defaults.payment_terms_days),
    footer_fr: c.footer_fr ?? '',
    footer_en: c.footer_en ?? '',
  }
}

export function useCompanyForm(initial: CompanyFormState = EMPTY) {
  const [form, setForm] = useState<CompanyFormState>(initial)
  const set = <K extends keyof CompanyFormState>(key: K, value: CompanyFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))
  const reset = () => setForm(EMPTY)
  return { form, set, reset }
}

/** `POST …/companies` body. */
export function toCreateBody(f: CompanyFormState): CreateCompanyBody {
  return {
    slug: f.slug.trim(),
    name: f.name.trim(),
    legal_name: orNull(f.legal_name) ?? undefined,
    address: {
      street: orNull(f.street),
      building: orNull(f.building),
      postal_code: orNull(f.postal_code),
      city: orNull(f.city),
      country: orNull(f.country),
    },
    email: orNull(f.email),
    iban: orNull(f.iban),
    qr_iban: orNull(f.qr_iban),
    vat_registered: f.vat_registered,
    uid: orNull(f.uid),
    vat_number: orNull(f.vat_number),
    defaults: {
      currency: f.default_currency.trim() || undefined,
      language: (f.default_language || undefined) as DocumentLanguage | undefined,
      ref_type: (f.default_ref_type || undefined) as ReferenceType | undefined,
      vat_rate: orNull(f.default_vat_rate),
      prices_include_vat: f.default_prices_include_vat,
      payment_terms_days: f.payment_terms_days.trim() === '' ? undefined : Number(f.payment_terms_days),
    },
    rounding: f.rounding as CreateCompanyBody['rounding'],
    number_format: orNull(f.number_format) ?? undefined,
    footer_fr: orNull(f.footer_fr),
    footer_en: orNull(f.footer_en),
    external_ref: orNull(f.external_ref),
  }
}

/**
 * `PATCH …/companies/{slug}` body — flat keys. `isOwner` decides whether
 * `iban`/`qr_iban` are included at all (see this file's header).
 */
export function toEditPatch(f: CompanyFormState, isOwner: boolean): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    name: f.name.trim(),
    legal_name: orNull(f.legal_name) ?? f.legal_name.trim(),
    street: orNull(f.street),
    building: orNull(f.building),
    postal_code: orNull(f.postal_code),
    city: orNull(f.city),
    country: orNull(f.country),
    email: orNull(f.email),
    vat_registered: f.vat_registered,
    uid: orNull(f.uid),
    vat_number: orNull(f.vat_number),
    default_currency: f.default_currency.trim(),
    default_language: f.default_language,
    default_ref_type: f.default_ref_type,
    default_vat_rate: orNull(f.default_vat_rate),
    default_prices_include_vat: f.default_prices_include_vat,
    payment_terms_days: f.payment_terms_days.trim() === '' ? undefined : Number(f.payment_terms_days),
    rounding: f.rounding,
    number_format: f.number_format.trim(),
    footer_fr: orNull(f.footer_fr),
    footer_en: orNull(f.footer_en),
    external_ref: orNull(f.external_ref),
  }
  if (isOwner) {
    patch.iban = orNull(f.iban)
    patch.qr_iban = orNull(f.qr_iban)
  }
  return patch
}

export function CompanyFormFields({
  form,
  set,
  mode,
  isOwner,
}: {
  form: CompanyFormState
  set: <K extends keyof CompanyFormState>(key: K, value: CompanyFormState[K]) => void
  /** `create` shows the slug field (immutable after); `edit` shows it read-only. */
  mode: 'create' | 'edit'
  isOwner: boolean
}) {
  return (
    <div className="space-y-6">
      <Section title="Identity" padded>
        <FormGrid cols={2}>
          <FormField label="Slug" htmlFor="input-slug" required={mode === 'create'} hint={mode === 'edit' ? 'Immutable — appears in URLs and every URN.' : 'Lowercase, the CLI and URL handle.'}>
            <Input
              id="input-slug"
              data-testid="input-slug"
              value={form.slug}
              onChange={(e) => set('slug', e.target.value)}
              placeholder="acme"
              disabled={mode === 'edit'}
            />
          </FormField>
          <FormField label="Name" htmlFor="input-name" required>
            <Input id="input-name" data-testid="input-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </FormField>
          <FormField label="Legal name" htmlFor="input-legal_name" hint="Must match the bank account holder — prints on the payment part.">
            <Input id="input-legal_name" data-testid="input-legal_name" value={form.legal_name} onChange={(e) => set('legal_name', e.target.value)} />
          </FormField>
          <FormField label="External ref" htmlFor="input-external_ref" hint="Your own identifier, unique per workspace.">
            <Input id="input-external_ref" data-testid="input-external_ref" value={form.external_ref} onChange={(e) => set('external_ref', e.target.value)} />
          </FormField>
        </FormGrid>
      </Section>

      <Section title="Address" padded>
        <FormGrid cols={2}>
          <FormField label="Street" htmlFor="input-street">
            <Input id="input-street" data-testid="input-street" value={form.street} onChange={(e) => set('street', e.target.value)} />
          </FormField>
          <FormField label="Building" htmlFor="input-building">
            <Input id="input-building" data-testid="input-building" value={form.building} onChange={(e) => set('building', e.target.value)} />
          </FormField>
          <FormField label="Postal code" htmlFor="input-postal_code">
            <Input id="input-postal_code" data-testid="input-postal_code" value={form.postal_code} onChange={(e) => set('postal_code', e.target.value)} />
          </FormField>
          <FormField label="City" htmlFor="input-city">
            <Input id="input-city" data-testid="input-city" value={form.city} onChange={(e) => set('city', e.target.value)} />
          </FormField>
          <FormField label="Country" htmlFor="input-country" hint="ISO 3166-1 alpha-2, e.g. CH.">
            <Input id="input-country" data-testid="input-country" value={form.country} onChange={(e) => set('country', e.target.value.toUpperCase())} maxLength={2} />
          </FormField>
          <FormField label="Email" htmlFor="input-email">
            <Input id="input-email" data-testid="input-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </FormField>
        </FormGrid>
      </Section>

      <Section title="Bank & payment" description="IBAN and QR-IBAN are owner-only: changing one redirects real money." padded>
        <FormGrid cols={2}>
          <FormField
            label="IBAN"
            htmlFor="input-iban"
            lockedReason={!isOwner ? 'Only the workspace owner may change this.' : undefined}
          >
            <Input
              id="input-iban"
              data-testid="input-iban"
              value={form.iban}
              onChange={(e) => set('iban', e.target.value)}
              disabled={!isOwner}
            />
          </FormField>
          <FormField
            label="QR-IBAN"
            htmlFor="input-qr_iban"
            hint="IID 30000–31999. Required for a QRR reference."
            lockedReason={!isOwner ? 'Only the workspace owner may change this.' : undefined}
          >
            <Input
              id="input-qr_iban"
              data-testid="input-qr_iban"
              value={form.qr_iban}
              onChange={(e) => set('qr_iban', e.target.value)}
              disabled={!isOwner}
            />
          </FormField>
          <FormField label="Rounding" htmlFor="input-rounding" hint="Changes every total this company has ever derived — nothing is stored.">
            <Select id="input-rounding" data-testid="input-rounding" value={form.rounding} onChange={(e) => set('rounding', e.target.value)}>
              {ROUNDING_POLICIES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Number format" htmlFor="input-number_format" hint='e.g. "AC-{YYYY}-{SEQ4}".'>
            <Input id="input-number_format" data-testid="input-number_format" value={form.number_format} onChange={(e) => set('number_format', e.target.value)} placeholder="AC-{SEQ4}" />
          </FormField>
        </FormGrid>
      </Section>

      <Section title="VAT" padded>
        <FormGrid cols={2}>
          <FormField label="VAT registered" htmlFor="input-vat_registered" hint="Off means VAT is omitted entirely — no rate, no 0%, no block.">
            <Select
              id="input-vat_registered"
              data-testid="input-vat_registered"
              value={form.vat_registered ? 'yes' : 'no'}
              onChange={(e) => set('vat_registered', e.target.value === 'yes')}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          </FormField>
          <FormField label="UID" htmlFor="input-uid">
            <Input id="input-uid" data-testid="input-uid" value={form.uid} onChange={(e) => set('uid', e.target.value)} />
          </FormField>
          <FormField label="VAT number" htmlFor="input-vat_number">
            <Input id="input-vat_number" data-testid="input-vat_number" value={form.vat_number} onChange={(e) => set('vat_number', e.target.value)} />
          </FormField>
        </FormGrid>
      </Section>

      <Section title="Numbering & defaults" description="Prefills for new invoices — never read again once one is drafted." padded>
        <FormGrid cols={3}>
          <FormField label="Currency" htmlFor="input-default_currency">
            <Input id="input-default_currency" data-testid="input-default_currency" value={form.default_currency} onChange={(e) => set('default_currency', e.target.value.toUpperCase())} maxLength={3} />
          </FormField>
          <FormField label="Document language" htmlFor="input-default_language">
            <Select id="input-default_language" data-testid="input-default_language" value={form.default_language} onChange={(e) => set('default_language', e.target.value)}>
              {DOCUMENT_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Reference type" htmlFor="input-default_ref_type">
            <Select id="input-default_ref_type" data-testid="input-default_ref_type" value={form.default_ref_type} onChange={(e) => set('default_ref_type', e.target.value)}>
              {REFERENCE_TYPES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="VAT rate" htmlFor="input-default_vat_rate" hint="Null means new lines carry no VAT.">
            <Input id="input-default_vat_rate" data-testid="input-default_vat_rate" value={form.default_vat_rate} onChange={(e) => set('default_vat_rate', e.target.value)} placeholder="8.1" />
          </FormField>
          <FormField label="Prices include VAT" htmlFor="input-default_prices_include_vat">
            <Select
              id="input-default_prices_include_vat"
              data-testid="input-default_prices_include_vat"
              value={form.default_prices_include_vat ? 'yes' : 'no'}
              onChange={(e) => set('default_prices_include_vat', e.target.value === 'yes')}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </Select>
          </FormField>
          <FormField label="Payment terms (days)" htmlFor="input-payment_terms_days">
            <Input id="input-payment_terms_days" data-testid="input-payment_terms_days" value={form.payment_terms_days} onChange={(e) => set('payment_terms_days', e.target.value)} />
          </FormField>
          <FormField label="Footer (FR)" htmlFor="input-footer_fr" className="sm:col-span-3">
            <Input id="input-footer_fr" data-testid="input-footer_fr" value={form.footer_fr} onChange={(e) => set('footer_fr', e.target.value)} />
          </FormField>
          <FormField label="Footer (EN)" htmlFor="input-footer_en" className="sm:col-span-3">
            <Input id="input-footer_en" data-testid="input-footer_en" value={form.footer_en} onChange={(e) => set('footer_en', e.target.value)} />
          </FormField>
        </FormGrid>
      </Section>
    </div>
  )
}

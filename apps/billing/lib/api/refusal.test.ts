// The envelope a refusal becomes, asserted on the BODY a client reads.
//
// Watched failing on 2026-09-17 against the old per-route mapping
// (`Errors.forbidden(e.code, e.message, e.suggestion)`), pasted into the 403
// case: `error` was the code and `code` was the suggestion. Restored.
import { describe, expect, it } from 'vitest'
import { errorBody } from '@blackcode/platform-api'
import { refusalToApiError } from './refusal'
import { InvoiceRefused } from '@/lib/db/queries/invoices'
import { CompanyRefused } from '@/lib/db/queries/companies'

const STATUSES = [400, 403, 404, 409, 422, 500, 501, 502] as const

describe('refusalToApiError', () => {
  for (const status of STATUSES) {
    it(`${status}: code, sentence and suggestion each land in their own field`, () => {
      const e = new InvoiceRefused('the_code', 'The sentence.', 'the suggestion', status)
      const api = refusalToApiError(e)
      expect(api.status).toBe(status)
      expect(errorBody(api)).toMatchObject({
        code: 'the_code',
        error: 'The sentence.',
        suggestion: 'the suggestion',
      })
    })
  }

  it('maps a CompanyRefused 403 — the owner-only IBAN refusal — the same way', () => {
    const body = errorBody(
      refusalToApiError(new CompanyRefused('iban_owner_only', 'Only the owner may change it.', 'ask the owner', 403))
    )
    expect(body).toMatchObject({ code: 'iban_owner_only', error: 'Only the owner may change it.', suggestion: 'ask the owner' })
  })
})

// The seam's CURRENT contract: it refuses, loudly, with a code.
//
// **Phase 2 rewrites this test.** When `prepareInvoiceDocument` renders, the
// assertion flips to "returns bytes starting %PDF-" and "refuses an invoice the
// QR-bill standard would reject". Until then, what must never happen is the seam
// quietly returning something — a placeholder that let `send` mail a client a
// document without a payment part.
import { describe, expect, it } from 'vitest'
import { DOCUMENT_RENDERER_NOT_BUILT, prepareInvoiceDocument } from './document'
import { InvoiceRefused } from '@/lib/db/queries/invoices'
import type { Invoice } from '@/types'

describe('prepareInvoiceDocument (before phase 2)', () => {
  it('refuses with a 501 an agent can switch on, naming mark-sent as the recovery', async () => {
    const invoice = { seq: 7, number: 'BC-2026-0007' } as Invoice
    const err = await prepareInvoiceDocument({ invoice, company: {} as never }).catch((e) => e)
    expect(err).toBeInstanceOf(InvoiceRefused)
    expect(err.code).toBe(DOCUMENT_RENDERER_NOT_BUILT)
    expect(err.status).toBe(501)
    expect(err.suggestion).toContain('bk billing invoice mark-sent 7')
  })
})

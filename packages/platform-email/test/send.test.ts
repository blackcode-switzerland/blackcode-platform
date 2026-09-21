// The one Resend call, observed from the outside.
//
// ── WHAT THIS GUARDS ───────────────────────────────────────────────────────
// `sendDocumentEmail` exists to carry a file. The failure it has to catch is not
// an exception — it is a well-formed email that says "Attached: BC-2026-0033.pdf"
// and has nothing attached, because somebody tidied the payload object in
// `deliver()`. Every other layer stays green through that: the route gets
// `sent: true`, the invoice is marked sent, the audit row names a message id.
// So the assertion is on the PAYLOAD THE TRANSPORT RECEIVED, never on the
// result the sender returned.
//
// Watched failing on 2026-09-17, one mutation at a time, each restored:
//   - `attachments` spread deleted from `deliver()` -> the BYTES case went red,
//     and only that one. (A header written before the run predicted three; the
//     run said one. The comment records the run.)
//   - `replyTo` spread deleted -> the reply-to case went red
//   - the `idempotencyKey` option replaced with `undefined` -> the same case

import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendSpy = vi.fn()
let enabled = true

vi.mock('../src/client', () => ({
  emailEnabled: () => enabled,
  canDeliverEmail: () => enabled || process.env.NODE_ENV !== 'production',
  getResend: () => (enabled ? { emails: { send: sendSpy } } : null),
}))

// The failure log writes to a database this test does not have. What matters is
// that a failure is REPORTED to the caller, which the result assertions cover.
const logged = vi.fn()
vi.mock('@blackcode/platform-db', () => ({
  insertErrorEvent: (...args: unknown[]) => logged(...args),
}))

import { createEmailSender } from '../src/send'
import type { PlatformDb } from '@blackcode/platform-db'

const identity = {
  name: 'b/billing',
  appUrl: 'https://billing.example.test',
  accent: '#0f6b44',
  contactEmail: 'contact@example.test',
}

function sender() {
  return createEmailSender({ app: 'billing', getDb: () => ({}) as PlatformDb, identity })
}

const pdf = Buffer.from('%PDF-1.7\n% not a real document, a byte pattern to compare\n')

const input = {
  subject: 'Invoice BC-2026-0033',
  heading: 'Invoice BC-2026-0033 from Acme SA',
  body: 'Hello,\n\nPlease find our invoice attached.\nThank you.',
  attachmentName: 'BC-2026-0033.pdf',
}

beforeEach(() => {
  enabled = true
  sendSpy.mockReset()
  logged.mockReset()
  sendSpy.mockResolvedValue({ data: { id: 'msg_123' }, error: null })
  process.env.RESEND_FROM_EMAIL = 'admin@example.test'
})

describe('sendDocumentEmail', () => {
  it('hands the attachment BYTES to the transport, not just its name', async () => {
    const res = await sender().sendDocumentEmail('client@example.test', input, {
      attachments: [{ filename: 'BC-2026-0033.pdf', content: pdf, contentType: 'application/pdf' }],
    })

    expect(res).toEqual({ sent: true, messageId: 'msg_123' })
    expect(sendSpy).toHaveBeenCalledTimes(1)
    const [payload] = sendSpy.mock.calls[0]
    expect(payload.attachments).toHaveLength(1)
    expect(payload.attachments[0].filename).toBe('BC-2026-0033.pdf')
    expect(payload.attachments[0].contentType).toBe('application/pdf')
    // The same bytes, compared as bytes. A `content: filename` or a stringified
    // buffer would both be truthy.
    expect(Buffer.compare(payload.attachments[0].content, pdf)).toBe(0)
  })

  it('carries reply-to, cc and the idempotency key to the transport', async () => {
    await sender().sendDocumentEmail('client@example.test', input, {
      cc: ['accounts@example.test'],
      replyTo: 'billing@acme.example.test',
      attachments: [{ filename: 'x.pdf', content: pdf }],
      idempotencyKey: 'billing-invoice-send/1/7/abc',
    })

    const [payload, options] = sendSpy.mock.calls[0]
    expect(payload.to).toBe('client@example.test')
    expect(payload.cc).toEqual(['accounts@example.test'])
    expect(payload.replyTo).toBe('billing@acme.example.test')
    expect(payload.from).toBe('b/billing <admin@example.test>')
    expect(options).toEqual({ idempotencyKey: 'billing-invoice-send/1/7/abc' })
    // The footer names the reply-to, not the platform's contact address — a
    // client's question about a bill must reach the business that sent it.
    expect(payload.text).toContain('billing@acme.example.test')
    expect(payload.text).not.toContain('contact@example.test')
  })

  it('escapes the body: typed text is never markup in a mail under our domain', async () => {
    await sender().sendDocumentEmail(
      'client@example.test',
      { ...input, body: '<img src=x onerror=alert(1)> & "quotes"' },
      { attachments: [{ filename: 'x.pdf', content: pdf }] }
    )
    const [payload] = sendSpy.mock.calls[0]
    expect(payload.html).not.toContain('<img src=x')
    expect(payload.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot;')
  })

  it('refuses a document email with nothing attached, without calling the transport', async () => {
    const res = await sender().sendDocumentEmail('client@example.test', input, { attachments: [] })
    expect(res.sent).toBe(false)
    expect(res.error).toMatch(/attachment/)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('reports a transport refusal as not sent, with no message id', async () => {
    sendSpy.mockResolvedValue({ data: null, error: { message: 'invalid `to` field' } })
    const res = await sender().sendDocumentEmail('nope', input, {
      attachments: [{ filename: 'x.pdf', content: pdf }],
    })
    expect(res).toEqual({ sent: false, error: 'invalid `to` field' })
    expect(logged).toHaveBeenCalledTimes(1)
  })

  it('does not call the transport when this deployment has no key', async () => {
    enabled = false
    const res = await sender().sendDocumentEmail('client@example.test', input, {
      attachments: [{ filename: 'x.pdf', content: pdf }],
    })
    expect(res).toEqual({ sent: false, skipped: 'not_configured' })
    expect(sendSpy).not.toHaveBeenCalled()
  })
})

describe('the two older templates are unchanged on the wire', () => {
  it('an invitation payload has exactly the keys it had before documents existed', async () => {
    await sender().sendInvitationEmail('invitee@example.test', {
      workspaceName: 'Acme',
      inviterName: 'Ana',
      acceptUrl: 'https://billing.example.test/invitations/t',
      inviteeHasAccount: false,
      expiresInDays: 7,
    })
    const [payload, options] = sendSpy.mock.calls[0]
    expect(Object.keys(payload).sort()).toEqual(['from', 'html', 'subject', 'text', 'to'])
    expect(options).toBeUndefined()
  })
})

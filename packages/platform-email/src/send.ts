// Email sending — best-effort. Sending must never break the operation that
// triggered it (e.g. an invitation is still valid even if its email bounces).
// On failure we log a warn-level error_event and return { sent: false }.
//
// Transactional email is kept to a minimum: workspace invitations, password
// resets, and one DOCUMENT email — a message that carries a file a person is
// meant to keep (b/billing's invoice PDF, 2026-09-17). Everything else stays in
// the in-app inbox.
//
// ---------------------------------------------------------------------------
// THE DOCUMENT EMAIL IS SHARED, AND ITS COPY IS A PARAMETER
// ---------------------------------------------------------------------------
// b/billing needed to mail a PDF. The tempting shape was a `sendInvoiceEmail`
// in `apps/billing` — and `identity.ts` refuses exactly that, because a per-app
// template is a copy with extra steps. So the package gained ONE template whose
// subject, heading and body arrive as input, and ONE method that attaches files
// and sets a reply-to. Any app with a document to send uses the same pair.
//
// ── WHY `sendDocumentEmail` RETURNS A MESSAGE ID AND THE OTHERS DO NOT ─────
// An invitation or a reset code is disposable: if it bounces, the person asks
// again. An invoice is a legal claim, and "we sent it" has to be answerable
// later with something the transport also knows. `messageId` is that answer. It
// is on `SendResult` for every kind because the transport always returns one;
// only a caller that records it has a reason to read it.
//
// ---------------------------------------------------------------------------
// A FACTORY, NOT FOUR FREE FUNCTIONS
// ---------------------------------------------------------------------------
// The old `apps/issues/lib/email/send.ts` reached for two things a package
// cannot have: `BRAND`, and issues' own `db` import for the failure log. Both
// arrive as configuration now, and the app binds them once in
// `apps/<app>/lib/email/send.ts`. That binding file is the ONLY place an app's
// name, accent and database meet the sender.
//
// ---------------------------------------------------------------------------
// WHY THESE STILL RETURN `{ sent: false }` RATHER THAN THROWING
// ---------------------------------------------------------------------------
// `PasswordOtpSender` in `platform-api/src/routes/password.ts` says it in the
// type: the sender MUST NOT throw. A delivery failure is not a reason to refuse
// a password change, and by the time we get here the caller has already spent
// a rate-limit slot and written an OTP row.
//
// **That is not the same as degrading silently.** The honest-degradation rule
// is enforced one level up, BEFORE any work: a route checks `emailEnabled()`
// first and refuses with 503 `email_not_configured` when this deployment has no
// key at all. What survives down here is the per-recipient failure — a bounce,
// a Resend outage — which genuinely is best-effort and genuinely cannot be
// distinguished from success at request time.

import type { PlatformDb } from '@blackcode/platform-db'
import { insertErrorEvent } from '@blackcode/platform-db'
import { canDeliverEmail, emailEnabled, getResend } from './client'
import { fromAddress, type EmailIdentity } from './identity'
import {
  documentEmail,
  invitationEmail,
  passwordResetEmail,
  type DocumentEmailInput,
  type InvitationEmailInput,
  type PasswordResetEmailInput,
} from './templates'

export interface SendResult {
  sent: boolean
  skipped?: 'not_configured'
  error?: string
  /** The transport's id for an accepted message. Absent unless `sent`. */
  messageId?: string
}

/** A file carried by a document email. */
export interface EmailAttachment {
  filename: string
  content: Buffer
  /** Derived from the filename by the transport when absent. */
  contentType?: string
}

/**
 * How a document email travels, as opposed to what it says.
 *
 * Kept apart from `DocumentEmailInput` because these are not copy: a template
 * never sees an attachment's bytes or a reply-to address, and nothing a template
 * renders should be able to change who the mail goes to.
 */
export interface DocumentDelivery {
  cc?: string[]
  /**
   * Where a reply goes. For an invoice, the ISSUING COMPANY's address — the From
   * line is the platform's verified mailbox (identity.ts), and a client who
   * replies to a bill must reach the business that sent it, not us.
   */
  replyTo?: string
  /** At least one. A document email with nothing attached is refused. */
  attachments: EmailAttachment[]
  /**
   * Passed to the transport as its `Idempotency-Key`. A caller that derives it
   * from WHAT is being sent makes a retried request deliver once — which is the
   * difference between one invoice in a client's inbox and two.
   */
  idempotencyKey?: string
}

export interface EmailSenderConfig {
  /** This app's slug, for `platform.error_events.app`. */
  app: string
  /** Lazy so binding this at module scope does not open a connection. */
  getDb: () => PlatformDb
  /** Who the mail is from. See identity.ts. */
  identity: EmailIdentity
}

export interface EmailSender {
  /** Does this deployment have a Resend key at all. */
  emailEnabled(): boolean
  /** The honest-degradation check a route makes BEFORE minting a code.
   *  Not the same as `emailEnabled()` — see client.ts. */
  canDeliverEmail(): boolean
  sendInvitationEmail(to: string, input: InvitationEmailInput): Promise<SendResult>
  sendPasswordResetEmail(to: string, input: PasswordResetEmailInput): Promise<SendResult>
  /**
   * A message carrying a document. **Never throws**, like the other two; a
   * caller that must not proceed on failure branches on `sent`.
   */
  sendDocumentEmail(
    to: string,
    input: DocumentEmailInput,
    delivery: DocumentDelivery
  ): Promise<SendResult>
}

type EmailKind = 'invitation' | 'password_reset' | 'document'

/** Where each kind's failure is filed. A document email has no one route: the package does not know which app's page sent it. */
const FAILURE_ROUTE: Record<EmailKind, string | null> = {
  invitation: '/api/workspaces/[ws]/invitations',
  password_reset: '/api/*/password*',
  document: null,
}

export function createEmailSender(config: EmailSenderConfig): EmailSender {
  async function logEmailFailure(to: string, message: string, kind: EmailKind): Promise<void> {
    try {
      await insertErrorEvent(config.getDb(), {
        app: config.app,
        level: 'warn',
        code: 'email_send_failed',
        message: `${kind} email failed: ${message}`,
        stack: null,
        route: FAILURE_ROUTE[kind],
        method: 'POST',
        status_code: null,
        user_id: null,
        // Domain only — never store the full recipient address.
        context: { recipient_domain: to.split('@')[1] ?? null, kind },
      })
    } catch {
      // Logging is itself best-effort.
    }
  }

  async function deliver(
    to: string,
    kind: EmailKind,
    rendered: { subject: string; html: string; text: string },
    extra: Partial<DocumentDelivery> = {}
  ): Promise<SendResult> {
    const resend = getResend()
    if (!resend) return { sent: false, skipped: 'not_configured' }

    try {
      // Each optional field is spread in only when present, so an invitation's
      // payload is byte-for-byte what it was before documents existed —
      // `test/send.test.ts` asserts the exact key set.
      const { data, error } = await resend.emails.send(
        {
          from: fromAddress(config.identity),
          to,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          ...(extra.cc && extra.cc.length > 0 ? { cc: extra.cc } : {}),
          ...(extra.replyTo ? { replyTo: extra.replyTo } : {}),
          ...(extra.attachments && extra.attachments.length > 0
            ? {
                attachments: extra.attachments.map((a) => ({
                  filename: a.filename,
                  content: a.content,
                  ...(a.contentType ? { contentType: a.contentType } : {}),
                })),
              }
            : {}),
        },
        extra.idempotencyKey ? { idempotencyKey: extra.idempotencyKey } : undefined
      )
      if (error) {
        const message = error.message ?? String(error)
        await logEmailFailure(to, message, kind)
        return { sent: false, error: message }
      }
      return data?.id ? { sent: true, messageId: data.id } : { sent: true }
    } catch (err) {
      const message = (err as Error)?.message ?? 'unknown'
      await logEmailFailure(to, message, kind)
      return { sent: false, error: message }
    }
  }

  return {
    emailEnabled,
    canDeliverEmail,

    async sendInvitationEmail(to, input) {
      if (!emailEnabled()) return { sent: false, skipped: 'not_configured' }
      return deliver(to, 'invitation', invitationEmail(config.identity, input))
    },

    async sendPasswordResetEmail(to, input) {
      if (!emailEnabled()) return { sent: false, skipped: 'not_configured' }
      return deliver(to, 'password_reset', passwordResetEmail(config.identity, input))
    },

    async sendDocumentEmail(to, input, delivery) {
      if (!emailEnabled()) return { sent: false, skipped: 'not_configured' }
      // Refused here rather than typed away: `attachments: []` satisfies the
      // type, and a "please find attached" email with nothing attached is the
      // one this method exists not to send.
      if (!delivery.attachments || delivery.attachments.length === 0) {
        return { sent: false, error: 'a document email must carry at least one attachment' }
      }
      return deliver(
        to,
        'document',
        documentEmail(config.identity, { ...input, replyTo: delivery.replyTo }),
        delivery
      )
    },
  }
}

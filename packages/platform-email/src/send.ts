// Email sending — best-effort. Sending must never break the operation that
// triggered it (e.g. an invitation is still valid even if its email bounces).
// On failure we log a warn-level error_event and return { sent: false }.
//
// Transactional email is kept to a minimum: workspace invitations and password
// resets. Everything else stays in the in-app inbox.
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
  invitationEmail,
  passwordResetEmail,
  type InvitationEmailInput,
  type PasswordResetEmailInput,
} from './templates'

export interface SendResult {
  sent: boolean
  skipped?: 'not_configured'
  error?: string
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
}

export function createEmailSender(config: EmailSenderConfig): EmailSender {
  async function logEmailFailure(
    to: string,
    message: string,
    kind: 'invitation' | 'password_reset'
  ): Promise<void> {
    try {
      await insertErrorEvent(config.getDb(), {
        app: config.app,
        level: 'warn',
        code: 'email_send_failed',
        message: `${kind} email failed: ${message}`,
        stack: null,
        route:
          kind === 'invitation' ? '/api/workspaces/[ws]/invitations' : '/api/*/password*',
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
    kind: 'invitation' | 'password_reset',
    rendered: { subject: string; html: string; text: string }
  ): Promise<SendResult> {
    const resend = getResend()
    if (!resend) return { sent: false, skipped: 'not_configured' }

    try {
      const { error } = await resend.emails.send({
        from: fromAddress(config.identity),
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      })
      if (error) {
        const message = error.message ?? String(error)
        await logEmailFailure(to, message, kind)
        return { sent: false, error: message }
      }
      return { sent: true }
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
  }
}

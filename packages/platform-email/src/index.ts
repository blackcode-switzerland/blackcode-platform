// @blackcode/platform-email — transactional email.
//
// Promoted from `apps/issues/lib/email/` on 2026-08-11 (multiAppFinalRefactor
// Phase 10), closing open item 8 in `docs/adding-an-app.md`. It was the last
// significant piece of shared behaviour that had never become a package,
// because `apps/issues` was the only sender — and it was the reason `apps/sales`
// could not run its own password reset and therefore sent people to issues for
// one. That screen is what prompted this phase.
//
// ---------------------------------------------------------------------------
// HOW AN APP USES IT
// ---------------------------------------------------------------------------
// Once, in `apps/<app>/lib/email/send.ts`:
//
//     export const { sendInvitationEmail, sendPasswordResetEmail, emailEnabled } =
//       createEmailSender({
//         app: APP_SLUG,
//         getDb: () => getDb(),
//         identity: { name: APP_NAME, appUrl: …, accent: …, contactEmail: … },
//       })
//
// Everything else imports from that binding, never from this package directly —
// the same rule `@/lib/storage` follows, and for the same reason: the binding is
// where the app's identity and database are attached, and an import that skips
// it is an import that skipped them.
//
// ---------------------------------------------------------------------------
// WHAT THIS PACKAGE DELIBERATELY DOES NOT DO
// ---------------------------------------------------------------------------
// It does not decide WHETHER to send. `emailEnabled()` is exported so the
// caller can refuse honestly (503 `email_not_configured`) before spending a
// rate-limit slot; the sender itself never throws, because by the time it runs
// the operation it supports has already happened. See send.ts.
//
// It does not know an app's slug, name, colour or URL. See identity.ts, which
// argues why the app's contribution stops at four fields and does not extend to
// a palette or a template set.

export { canDeliverEmail, emailEnabled, getResend, resetResendClient } from './client'
export { fromAddress } from './identity'
export type { EmailIdentity } from './identity'
export { createEmailSender } from './send'
export type { EmailSender, EmailSenderConfig, SendResult } from './send'
export { invitationEmail, passwordResetEmail } from './templates'
export type {
  InvitationEmailInput,
  PasswordResetEmailInput,
  RenderedEmail,
} from './templates'

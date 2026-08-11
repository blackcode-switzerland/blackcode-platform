// Email sending — best-effort. Sending must never break the operation that
// triggered it (e.g. an invitation is still valid even if its email bounces).
// On failure we log a warn-level error_event and return { sent: false }.
//
// Transactional email is kept to a minimum: workspace invitations, password
// resets, and the one-off CLI-only migration notice. Everything else stays in
// the in-app inbox.

import { emailEnabled, fromAddress, getResend } from './client'
import {
  invitationEmail,
  passwordResetEmail,
  type InvitationEmailInput,
  type PasswordResetEmailInput,
} from './templates'
import { insertErrorEvent } from '@/lib/db/queries/error-events'

export interface SendResult {
  sent: boolean
  skipped?: 'not_configured'
  error?: string
}

export async function sendInvitationEmail(
  to: string,
  input: InvitationEmailInput
): Promise<SendResult> {
  if (!emailEnabled()) {
    return { sent: false, skipped: 'not_configured' }
  }
  const resend = getResend()
  if (!resend) return { sent: false, skipped: 'not_configured' }

  const { subject, html, text } = invitationEmail(input)

  try {
    const { error } = await resend.emails.send({
      from: fromAddress(),
      to,
      subject,
      html,
      text,
    })
    if (error) {
      await logEmailFailure(to, error.message ?? String(error))
      return { sent: false, error: error.message ?? 'send failed' }
    }
    return { sent: true }
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown'
    await logEmailFailure(to, message)
    return { sent: false, error: message }
  }
}

export async function sendPasswordResetEmail(
  to: string,
  input: PasswordResetEmailInput
): Promise<SendResult> {
  if (!emailEnabled()) {
    return { sent: false, skipped: 'not_configured' }
  }
  const resend = getResend()
  if (!resend) return { sent: false, skipped: 'not_configured' }

  const { subject, html, text } = passwordResetEmail(input)

  try {
    const { error } = await resend.emails.send({
      from: fromAddress(),
      to,
      subject,
      html,
      text,
    })
    if (error) {
      await logEmailFailure(to, error.message ?? String(error), 'password_reset')
      return { sent: false, error: error.message ?? 'send failed' }
    }
    return { sent: true }
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown'
    await logEmailFailure(to, message, 'password_reset')
    return { sent: false, error: message }
  }
}

async function logEmailFailure(
  to: string,
  message: string,
  kind: 'invitation' | 'password_reset' = 'invitation'
): Promise<void> {
  try {
    await insertErrorEvent({
      level: 'warn',
      code: 'email_send_failed',
      message: `${kind} email failed: ${message}`,
      stack: null,
      route: kind === 'invitation' ? '/api/workspaces/[ws]/invitations' : '/api/*/password*',
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


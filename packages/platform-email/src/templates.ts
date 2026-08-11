// Email templates — light theme, single shared layout. Plain functions
// returning { subject, html, text }. Inline styles only (email clients strip
// <style> blocks in some cases, so every rule that matters is also inlined;
// the <style> block only carries the mobile media query, which is a
// progressive enhancement, not a requirement). One column, system fonts,
// ~520px max width, centered container so it reads well at any screen size.
//
// Layout convention: brand header, heading, intro copy and the primary
// button are center-aligned (the "look at me" path through the email).
// Supporting detail — the raw link, expiry/disclaimer notes, and the footer —
// stays left-aligned, which reads more naturally as fine print.
//
// Brand logo: referenced by absolute URL (`identity.appUrl` + /logo.png) so it
// renders in Gmail/Outlook/Apple Mail. (Base64 data-URIs are blocked by Gmail
// and a 77KB logo would also exceed Gmail's ~102KB clipping limit, so a hosted
// URL is the professional choice.) The wordmark always shows as text, so the
// brand is clear even if images are blocked.
//
// ---------------------------------------------------------------------------
// EVERY APP-SPECIFIC FACT ARRIVES AS `identity`. THERE IS NO `BRAND` CONSTANT.
// ---------------------------------------------------------------------------
// Until 2026-08-11 this file opened with `const BRAND = 'Blackcode Issues'` and
// read `process.env.NEXTAUTH_URL` directly, which is what made it one app's
// module rather than a package. Both are parameters now. `identity.ts` argues
// why the parameter stops at four fields.

import type { EmailIdentity } from './identity'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Light-theme palette. NOT an app input — see identity.ts note 4: these are
// contrast-tuned against each other and nothing in this repo renders an email
// to catch an app that broke them. `accent` is the one exception, and it is
// an app input, because it only ever carries white text on a solid fill.
const C = {
  page: '#f4f5f7',
  card: '#ffffff',
  border: '#e6e7eb',
  heading: '#111114',
  body: '#3f3f46',
  muted: '#71717a',
  faint: '#a1a1aa',
  codeBg: '#f4f4f6',
}

// Wraps content in the shared shell: centered brand header, white card,
// left-aligned footer. `contentHtml` decides its own internal alignment.
function renderEmail(
  identity: EmailIdentity,
  opts: { previewText: string; contentHtml: string }
): string {
  const brand = escapeHtml(identity.name)
  const base = identity.appUrl.replace(/\/$/, '')
  const logo = base
    ? `<img src="${base}/logo.png" width="28" height="28" alt="${brand}"
         style="display:inline-block;vertical-align:middle;border-radius:6px;border:0;" />`
    : ''

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light" />
    <style>
      @media only screen and (max-width: 600px) {
        .bc-page { padding: 20px 12px !important; }
        .bc-card { padding: 24px 20px !important; border-radius: 12px !important; }
        .bc-heading { font-size: 18px !important; }
        .bc-button-link { display: block !important; width: 100% !important; box-sizing: border-box !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:${C.page};-webkit-font-smoothing:antialiased;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <span style="display:none!important;opacity:0;color:transparent;visibility:hidden;height:0;width:0;overflow:hidden;">${escapeHtml(
      opts.previewText
    )}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bc-page" style="background:${C.page};padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
            <!-- brand (centered) -->
            <tr>
              <td align="center" style="padding:0 4px 20px;text-align:center;">
                <span style="vertical-align:middle;">${logo}</span>
                <span style="vertical-align:middle;margin-left:${logo ? '8px' : '0'};color:${C.heading};font-size:16px;font-weight:600;letter-spacing:-0.01em;">
                  ${brand}
                </span>
              </td>
            </tr>
            <!-- card -->
            <tr>
              <td class="bc-card" style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:32px;">
                ${opts.contentHtml}
              </td>
            </tr>
            <!-- footer (left-aligned) -->
            <tr>
              <td align="left" style="padding:20px 4px 0;text-align:left;">
                <p style="margin:0 0 4px;color:${C.faint};font-size:12px;line-height:1.5;">
                  This is an automated message from ${brand}.
                </p>
                <p style="margin:0;color:${C.faint};font-size:12px;line-height:1.5;">
                  Need help or want to reply? Contact us at
                  <a href="mailto:${identity.contactEmail}" style="color:${C.muted};">${escapeHtml(
                    identity.contactEmail
                  )}</a>.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

// Centered, full-width-on-mobile call-to-action button. Uses the
// table > td[align=center] technique so Outlook's Word engine centers it too.
function buttonHtml(identity: EmailIdentity, url: string, label: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="border-radius:10px;background:${identity.accent};">
              <a href="${url}" class="bc-button-link"
                style="display:inline-block;padding:11px 26px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;text-align:center;">
                ${label}
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

// ---------- invitation ----------

export interface InvitationEmailInput {
  workspaceName: string
  inviterName: string
  acceptUrl: string
  inviteeHasAccount: boolean
  expiresInDays: number
}

export function invitationEmail(
  identity: EmailIdentity,
  input: InvitationEmailInput
): RenderedEmail {
  const brand = escapeHtml(identity.name)
  const ws = escapeHtml(input.workspaceName)
  const inviter = escapeHtml(input.inviterName)
  const url = input.acceptUrl
  const subject = `${input.inviterName} invited you to join ${input.workspaceName}`
  const accountLine = input.inviteeHasAccount
    ? 'Sign in and accept to start collaborating.'
    : "You'll create a free account when you accept — it takes a few seconds."

  const content = `
    <div style="text-align:center;">
      <h1 class="bc-heading" style="margin:0 0 14px;color:${C.heading};font-size:20px;font-weight:600;line-height:1.3;">
        You're invited to join ${ws}
      </h1>
      <p style="margin:0 0 8px;color:${C.body};font-size:14px;line-height:1.6;">
        <strong style="color:${C.heading};">${inviter}</strong> invited you to collaborate in
        <strong style="color:${C.heading};">${ws}</strong> on ${brand}.
      </p>
      <p style="margin:0;color:${C.muted};font-size:14px;line-height:1.6;">
        ${accountLine}
      </p>
      ${buttonHtml(identity, url, 'Accept invitation')}
    </div>
    <p style="margin:8px 0 0;color:${C.faint};font-size:12px;line-height:1.6;text-align:left;">
      This invitation expires in ${input.expiresInDays} days. If the button doesn't work,
      copy and paste this link into your browser:<br/>
      <a href="${url}" style="color:${identity.accent};word-break:break-all;">${url}</a>
    </p>
    <p style="margin:14px 0 0;color:${C.faint};font-size:12px;line-height:1.6;text-align:left;">
      If you weren't expecting this, you can safely ignore this email.
    </p>`

  const html = renderEmail(identity, {
    previewText: `${input.inviterName} invited you to join ${input.workspaceName} on ${identity.name}.`,
    contentHtml: content,
  })

  const text = [
    `${input.inviterName} invited you to join ${input.workspaceName} on ${identity.name}.`,
    ``,
    input.inviteeHasAccount
      ? 'Sign in and accept to start collaborating.'
      : "You'll create a free account when you accept.",
    ``,
    `Accept the invitation:`,
    url,
    ``,
    `This invitation expires in ${input.expiresInDays} days.`,
    `If you weren't expecting this, you can ignore this email.`,
    ``,
    `Need help or want to reply? Contact us at ${identity.contactEmail}.`,
  ].join('\n')

  return { subject, html, text }
}

// ---------- password reset ----------

export interface PasswordResetEmailInput {
  otp: string
  expiresInMinutes: number
  name?: string | null
}

export function passwordResetEmail(
  identity: EmailIdentity,
  input: PasswordResetEmailInput
): RenderedEmail {
  const greeting = input.name ? `Hi ${escapeHtml(input.name)},` : 'Hi,'
  const subject = `Your ${identity.name} password reset code`
  const code = escapeHtml(input.otp)

  const content = `
    <div style="text-align:center;">
      <h1 class="bc-heading" style="margin:0 0 14px;color:${C.heading};font-size:20px;font-weight:600;line-height:1.3;">
        Reset your password
      </h1>
      <p style="margin:0 0 20px;color:${C.body};font-size:14px;line-height:1.6;">
        ${greeting} use the code below to reset your password. It expires in
        ${input.expiresInMinutes} minutes.
      </p>
      <div style="margin:0 0 4px;padding:16px;background:${C.codeBg};border:1px solid ${C.border};border-radius:12px;text-align:center;">
        <span style="color:${C.heading};font-size:30px;font-weight:700;letter-spacing:.3em;font-family:'SF Mono',ui-monospace,Menlo,Consolas,monospace;">${code}</span>
      </div>
    </div>
    <p style="margin:20px 0 0;color:${C.faint};font-size:12px;line-height:1.6;text-align:left;">
      If you didn't request this, you can safely ignore this email — your password
      won't change. Never share this code with anyone.
    </p>`

  const html = renderEmail(identity, {
    previewText: `Your ${identity.name} password reset code is ${input.otp}.`,
    contentHtml: content,
  })

  const text = [
    `${input.name ? `Hi ${input.name},` : 'Hi,'}`,
    ``,
    `Use this code to reset your ${identity.name} password:`,
    ``,
    `    ${input.otp}`,
    ``,
    `It expires in ${input.expiresInMinutes} minutes. If you didn't request this, ignore`,
    `this email — your password won't change. Never share this code with anyone.`,
    ``,
    `Need help or want to reply? Contact us at ${identity.contactEmail}.`,
  ].join('\n')

  return { subject, html, text }
}

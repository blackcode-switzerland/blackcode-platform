// The templates carry no brand of their own — every word that names a company
// comes from the `EmailIdentity` the calling app supplies (identity.ts, note 1).
//
// ===========================================================================
// WHY THIS IS A RENDER, NOT A TEXT SCAN (TICKET #756, 2026-09-23)
// ===========================================================================
// The two apps that can ship under another company's name each carry a text
// scan over their own rendered surfaces (`apps/*/lib/no-brand-literal.test.ts`).
// This package is where their MAIL is assembled, and a mail is the one thing a
// patient receives without ever opening the app. A text scan here would have to
// exempt `identity.ts`, whose comments say `Blackcode Issues` as an example —
// and a scan that exempts a file is a scan that could be exempting the wrong
// one. So this renders every template with an identity that is not Blackcode's
// and reads the OUTPUT: subject, HTML and plain text. What a template renders
// is the only fact worth asserting about it.
//
// ── THE POSITIVE CASE COMES FIRST ──────────────────────────────────────────
// CLAUDE.md finding #16: a check built only on "was the bad thing absent?"
// cannot tell a clean template from an empty string. Each render must CONTAIN
// the identity's name and contact address before its absence of the brand
// counts for anything.

import { describe, it, expect } from 'vitest'
import { documentEmail, invitationEmail, passwordResetEmail } from '../src/templates'
import type { EmailIdentity } from '../src/identity'
import type { RenderedEmail } from '../src/templates'

const ZED: EmailIdentity = {
  name: 'Zed Invoicing',
  appUrl: 'https://zed.example',
  accent: '#123456',
  contactEmail: 'hello@zed.example',
}

/** The family name, the domain, the npm scope, the old binary, the sibling products. */
const BRAND = /blackcode|bc-issues|b\/billing|b\/books/i

const RENDERS: ReadonlyArray<{ template: string; out: RenderedEmail }> = [
  {
    template: 'invitationEmail',
    out: invitationEmail(ZED, {
      workspaceName: 'Clinic',
      inviterName: 'Dr. Example',
      acceptUrl: 'https://zed.example/invitations/abc',
      inviteeHasAccount: false,
      expiresInDays: 7,
    }),
  },
  {
    template: 'passwordResetEmail',
    out: passwordResetEmail(ZED, { otp: '123456', expiresInMinutes: 15, name: 'Pat' }),
  },
  {
    template: 'documentEmail',
    out: documentEmail(ZED, {
      subject: 'Facture 2026-0001',
      heading: 'Votre facture',
      body: 'Bonjour,\n\nVeuillez trouver ci-joint votre facture.',
      attachmentName: 'facture-2026-0001.pdf',
      replyTo: 'billing@zed.example',
    }),
  },
]

describe('the mail templates render only the identity they are given', () => {
  it('renders every template this package exports (guards against a vacuous pass)', () => {
    expect(RENDERS.length).toBe(3)
    for (const r of RENDERS) {
      expect(r.out.html.length, `${r.template} rendered no HTML`).toBeGreaterThan(200)
      expect(r.out.text.length, `${r.template} rendered no text`).toBeGreaterThan(20)
    }
  })

  it('carries the identity — the positive case, asserted first', () => {
    for (const r of RENDERS) {
      expect(r.out.html, `${r.template}: HTML lacks the identity name`).toContain(ZED.name)
      expect(r.out.html, `${r.template}: HTML lacks the logo URL derived from appUrl`).toContain(`${ZED.appUrl}/logo.png`)
    }
    // The two account mails say the name in their text part too. The document
    // mail's text part does NOT (found by this assertion, 2026-09-23): it is the
    // heading, the covering note, the attachment and the reply-to line, and the
    // sender is identified by the From header and that address. Recorded rather
    // than changed, because adding a line would change what every deployment
    // sends today; the HTML part, which every mail client prefers, carries it.
    expect(RENDERS[0].out.text, 'invitation text lacks the identity name').toContain(ZED.name)
    expect(RENDERS[1].out.text, 'password-reset text lacks the identity name').toContain(ZED.name)
    expect(RENDERS[0].out.text, 'invitation text lacks the contact address').toContain(ZED.contactEmail)
    expect(RENDERS[2].out.text, 'document text lacks the reply-to').toContain('billing@zed.example')
  })

  it('names no brand of its own', () => {
    const offenders: string[] = []
    for (const r of RENDERS) {
      for (const part of ['subject', 'html', 'text'] as const) {
        const m = r.out[part].match(BRAND)
        if (m) offenders.push(`${r.template}.${part} renders "${m[0]}"`)
      }
    }
    expect(
      offenders,
      'the shared templates put a brand into a mail sent under another company’s name:\n' +
        offenders.join('\n') +
        '\n\nEvery word that names a company comes from `EmailIdentity` (identity.ts).'
    ).toEqual([])
  })
})

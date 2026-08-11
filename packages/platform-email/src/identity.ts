// WHAT AN APP SUPPLIES, AND WHY IT IS THIS AND NOT MORE.
//
// ---------------------------------------------------------------------------
// THE QUESTION THIS FILE ANSWERS
// ---------------------------------------------------------------------------
// When `apps/issues/lib/email/` was promoted here (2026-08-11, Phase 10), the
// open design question was the one agent 8 refused to answer in a margin:
// **does an app supply a name, a palette, or a whole template set?**
//
// The answer is a NAME, A URL, AN ACCENT AND A REPLY-TO. Not a palette, and
// emphatically not a template set. The reasoning, because the next person to
// want a second template set will look here first:
//
// 1. **Two template sets is the exact failure `docs/adding-an-app.md` open item
//    8 exists to prevent.** Its words: "the second one goes stale silently —
//    nothing renders both, so nothing compares them." A per-app `templates.ts`
//    is a copy with extra steps; it does not stop being a copy because a
//    package holds it.
//
// 2. **A transactional email is not a product surface.** The brief's "each
//    app's own visual language" is a rule about SCREENS — real pages, in a
//    browser, with that app's shell. This is a 520px light-only card that has
//    to survive Outlook's Word rendering engine. The design space is one
//    column, system fonts and inline styles; there is no visual language to
//    express in it beyond the wordmark and the button colour.
//
// 3. **What actually varies is countable.** `BRAND` appeared five times in the
//    old `templates.ts`: the From line, the header wordmark, the invitation
//    body, the subject of the reset mail, and the footer. The logo is
//    `appUrl + /logo.png`. The button is one colour. That is four facts, and
//    four facts is an identity, not a theme.
//
// 4. **A palette input would be four unwatched values.** `C.page`, `C.card`,
//    `C.border`, `C.muted` and the rest are contrast-tuned against each other
//    for a light-only email. Letting an app override them means an app can
//    ship unreadable mail, and nothing in this repo renders an email to catch
//    it. `accent` is safe alone because it only ever carries white text on a
//    solid fill.
//
// ---------------------------------------------------------------------------
// THE ADDRESS IS PLATFORM-WIDE. THE NAME IS THE APP.
// ---------------------------------------------------------------------------
// `RESEND_FROM_EMAIL` is `admin@blackcode.ch` — the apex domain, because
// Resend's free plan verifies ONE domain per account. So every app sends from
// the same mailbox and the app identity rides in the display name:
//
//     Blackcode Issues <admin@blackcode.ch>
//     b/sales <admin@blackcode.ch>
//
// This is the same un-hardcoding as `platform.uploads.app`, `labels.app` and
// `comments.parent_type`: one shared resource, an app column on top.

/**
 * Who an email is FROM, in an app's terms. Supplied by the app at the binding
 * site (`apps/<app>/lib/email/send.ts`), never inferred here — a platform
 * package that knew an app's name would be a platform package that knew about
 * one app.
 */
export interface EmailIdentity {
  /**
   * The display name, in the From line and in the body. `Blackcode Issues`,
   * `b/sales`. Apps read this from their own `lib/app.ts` `APP_NAME` so the
   * email and the UI cannot disagree.
   */
  name: string

  /**
   * This app's absolute origin, no trailing slash. Used for the logo
   * (`<appUrl>/logo.png` — a hosted URL, because Gmail blocks data-URIs) and
   * for nothing else. Empty string is legal and drops the logo; the wordmark
   * is text, so the brand survives.
   */
  appUrl: string

  /**
   * The primary button fill. Always carries white text, which is why an app
   * may set this and may not set the rest of the palette.
   */
  accent: string

  /** Where a human replies. Appears in the footer of every message. */
  contactEmail: string
}

/**
 * `Blackcode Issues <admin@blackcode.ch>`.
 *
 * Takes the identity rather than reading a constant — this is the whole point
 * of the promotion. The address half comes from the environment because it is
 * platform-wide; the name half comes from the app because it is not.
 */
export function fromAddress(identity: EmailIdentity): string {
  const email = process.env.RESEND_FROM_EMAIL ?? 'no-reply@example.com'
  return `${identity.name} <${email}>`
}

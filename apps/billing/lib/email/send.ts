// THIS APP'S EMAIL BINDING. Import from here, never from
// `@blackcode/platform-email` directly — the same rule `lib/api.ts` follows for
// the request layer, and for the same reason: the package cannot know which app
// it is sending as, and an app that answers that question in two places will
// answer it differently in one of them.
//
// What lives here is the four facts the package cannot know: which app this is,
// which database to log a failure to, what name goes in the From line, and what
// colour the button is. `packages/platform-email/src/identity.ts` argues out why
// it is those four and not a whole template set.
//
// ===========================================================================
// A DEPLOYMENT WITH NO RESEND KEY STILL BEHAVES, AND `dev` IS NOT `prod`
// ===========================================================================
// `canDeliverEmail` is passed to the request routes so a PRODUCTION deployment
// with no key answers **503 `email_not_configured`** rather than a cheerful 200.
// That is what stops this app sending somebody to watch an inbox nothing was
// sent to — "no email arrived" and "the email is slow" look identical to the
// person waiting.
//
// **Outside production it deliberately returns 200 and prints the code to the
// server log**, because the only person who can read that log is the developer
// already reading it, and refusing there would make the flow untestable without
// a Resend account.
//
// Do not "fix" that 200 into a 503. `canDeliverEmail()` is `emailEnabled() ||
// NODE_ENV !== 'production'` and the carve-out is the point — the honest-
// degradation rule is about production, where no such channel exists.
//
// ===========================================================================
// PHASE 3 EXTENDS THIS, AND THE EXTENSION IS IN THE PACKAGE, NOT HERE
// ===========================================================================
// `docs/billing-app-plan/phase-3-lifecycle-and-delivery.md` adds attachment
// support so an invoice PDF can be mailed. That is a change to
// `packages/platform-email` — one shared `documentEmail` template and
// `attachments` on the one Resend call — and this file gains one name in the
// destructuring. A per-app template set is refused by the package, and
// `sendDocumentEmail` arriving here as a local implementation would be that
// refusal routed around.
import { createEmailSender } from '@blackcode/platform-email'
import { getDb } from '@/lib/db/client'
import { APP_NAME, APP_SLUG, CONTACT_EMAIL, EMAIL_ACCENT } from '@/lib/app'

export type { SendResult } from '@blackcode/platform-email'

export const { canDeliverEmail, emailEnabled, sendInvitationEmail, sendPasswordResetEmail } =
  createEmailSender({
    app: APP_SLUG,
    getDb: () => getDb(),
    identity: {
      // `APP_NAME`, so the From line and the UI cannot drift apart. It is
      // environment-driven, which is what lets a rebranded copy of this app send
      // as its own company with no edit here.
      name: APP_NAME,
      appUrl: (process.env.NEXTAUTH_URL ?? '').replace(/\/$/, ''),
      // NOT `--primary`. See `EMAIL_ACCENT`'s own note in lib/app.ts: the accent
      // always carries white text, and the mockup's signal green is 2.00:1
      // against white — measured, not guessed.
      accent: EMAIL_ACCENT,
      // Also environment-driven: a copy of this app replying to
      // contact@blackcode.ch would be sending another company's clients to us.
      contactEmail: CONTACT_EMAIL,
    },
  })

// THIS APP'S EMAIL BINDING. Import from here, never from
// `@blackcode/platform-email` directly — the same rule `lib/api.ts` follows for
// the request layer, and for the same reason: the package cannot know which app
// it is sending as, and an app that answers that question in two places will
// answer it differently in one of them.
//
// ===========================================================================
// WHY b/books COULD NOT SEND UNTIL TODAY, AND WHAT THAT COST
// ===========================================================================
// Three screens carried the same apology, each written truthfully at the time:
// the login page said "reset it from b/issues or b/sales", Settings said
// "b/books has no password form yet", and `components/login-form.tsx` recorded
// that the routes did not exist and that adding them was the backend's side of
// the wall. None of that was a policy decision. It was one missing dependency.
//
// b/books took fullstack ownership on 2026-08-19, so the wall is gone and the
// three apologies with it. What is left here is the four facts the package
// cannot know: which app this is, which database to log a failure to, what name
// goes in the From line, and what colour the button is.
//
// ── A DEPLOYMENT WITH NO RESEND KEY STILL BEHAVES, AND `dev` IS NOT `prod` ─
// `canDeliverEmail` is passed to the request routes so a PRODUCTION deployment
// with no key answers **503 `email_not_configured`** rather than a cheerful 200.
// That is what stops this app sending somebody to watch an inbox nothing was
// sent to — "no email arrived" and "the email is slow" look identical to the
// person waiting.
//
// **Outside production it deliberately returns 200 and prints the code to the
// server log** (`[password-reset] OTP for …`), because the only person who can
// read that log is the developer already reading it, and refusing there would
// make the flow untestable without a Resend account. Verified on this machine
// 2026-08-19: with no `RESEND_API_KEY` anywhere, the request answered 200, the
// code appeared in the dev log, and the confirm step accepted it.
//
// Do not "fix" that 200 into a 503. `canDeliverEmail()` is `emailEnabled() ||
// NODE_ENV !== 'production'` and the carve-out is the point — the honest-
// degradation rule is about production, where no such channel exists.

import { createEmailSender } from '@blackcode/platform-email'
import { getDb } from '@/lib/db/client'
import { APP_NAME, APP_SLUG, EMAIL_ACCENT } from '@/lib/app'

export type { SendResult } from '@blackcode/platform-email'

export const {
  canDeliverEmail,
  emailEnabled,
  sendInvitationEmail,
  sendPasswordResetEmail,
} = createEmailSender({
  app: APP_SLUG,
  getDb: () => getDb(),
  identity: {
    // `APP_NAME`, so the From line and the UI cannot drift apart.
    name: APP_NAME,
    appUrl: (process.env.NEXTAUTH_URL ?? '').replace(/\/$/, ''),
    // NOT `--primary`. See `EMAIL_ACCENT`'s own note in lib/app.ts: the accent
    // always carries white text, and this app's fill is 1.84:1 against white.
    accent: EMAIL_ACCENT,
    contactEmail: 'contact@blackcode.ch',
  },
})

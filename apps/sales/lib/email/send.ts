// THIS APP'S EMAIL BINDING. Import from here, never from
// `@blackcode/platform-email` directly — the same rule `@/lib/storage` follows.
//
// b/sales could not send mail until 2026-08-11, and that single fact produced
// every complaint this phase exists to answer: no sign-up screen (an account
// created here had no way to recover a password), no forgot-password screen,
// and a Settings → Account page that sent people to another app to change the
// one password both apps share. None of that was a policy decision — it was
// `apps/issues/lib/email/` never having become a package.
//
// It is a package now, so what remains here is the three facts it cannot know:
// which app this is, which database to log failures to, and who the mail is
// from.

import { createEmailSender } from '@blackcode/platform-email'
import { getDb } from '@/lib/db/client'
import { APP_NAME, APP_SLUG } from '@/lib/app'
import { EMAIL_ACCENT } from '@/lib/pipeline'

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
    // This app's `--primary`, the emerald-teal from globals.css. The whole
    // point of `EmailIdentity.accent` is that a b/sales code arrives in b/sales'
    // colour rather than in the issues blue — the difference a recipient
    // actually sees between the two apps' mail.
    //
    // From `lib/pipeline.ts`, not written here: `lib/palette.test.ts` decides
    // where a hex may live in this app, and it caught this line spelling one.
    accent: EMAIL_ACCENT,
    contactEmail: 'contact@blackcode.ch',
  },
})

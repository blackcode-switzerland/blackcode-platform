// THIS APP'S EMAIL BINDING. Import from here, never from
// `@blackcode/platform-email` directly — the same rule `@/lib/storage` follows.
//
// The package holds the client, the templates and the failure logging. What
// lives here is the three facts it cannot know: which app this is (for
// `platform.error_events.app`), which database to log to, and who the mail is
// from.
//
// Until 2026-08-11 this directory held the whole module — `client.ts`,
// `send.ts` and a 260-line `templates.ts` opening with
// `const BRAND = 'Blackcode Issues'`. It moved to `packages/platform-email` in
// Phase 10 so `apps/sales` could send its own password-reset codes instead of
// pointing people at this app for one. `docs/adding-an-app.md` open item 8.

import { createEmailSender } from '@blackcode/platform-email'
import { db } from '@/lib/db/client'
import { APP_NAME, APP_SLUG } from '@/lib/app'

export type { SendResult } from '@blackcode/platform-email'

export const {
  canDeliverEmail,
  emailEnabled,
  sendInvitationEmail,
  sendPasswordResetEmail,
} =
  createEmailSender({
    app: APP_SLUG,
    getDb: () => db,
    identity: {
      // `APP_NAME`, so the From line and the UI cannot drift apart.
      name: APP_NAME,
      // The logo's origin. Empty in a deployment without it, which drops the
      // image and leaves the text wordmark — the brand survives either way.
      appUrl: (process.env.NEXTAUTH_URL ?? '').replace(/\/$/, ''),
      // This app's `--primary` is #007bd3; the email button has kept its own
      // blue since the templates were written, and changing it is a design
      // decision rather than a refactor, so the move preserves it byte-for-byte.
      accent: '#2563eb',
      contactEmail: 'contact@blackcode.ch',
    },
  })

// The public landing page.
//
// A new app's UI starts here. `@blackcode/platform-ui` carries the shared
// primitives and the theme tokens — import them rather than restyling, or the
// suite stops looking like one product. This page is deliberately plain in
// phase 0: phase 1 is where the real screens arrive, and a design shipped here
// is a design phase 1 has to undo.
//
// ── EVERY NAME ON THIS PAGE COMES FROM `APP_NAME` ──────────────────────────
// Not a literal. A copy of this app runs as another company's invoicing product
// (docs/billing-app-plan/standalone-deployment.md) and this is the first page a
// person sees; `BILLING_DISPLAY_NAME=Acme npm run dev` has to change it with no
// edit here. The phase-0 exit criteria grep this directory for the string
// `b/billing` and expect to find none.
import { APP_NAME } from '@/lib/app'

export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui', padding: 48, maxWidth: 640 }}>
      <h1>{APP_NAME}</h1>
      <p>
        Swiss invoicing: issuing companies, gapless invoice numbers, and QR-bill payment parts a
        bank will accept. Every invoice keeps a full record of who changed what, and nothing is
        ever deleted.
      </p>
      <p>
        <strong>Nothing is built yet.</strong> This deployment is registered, migrated and
        answering — it owns its <strong>tenancy</strong> (<code>billing.workspaces</code>,{' '}
        <code>workspace_members</code>, <code>invitations</code>), self-signup sits behind the
        platform whitelist, and a workspace is minted on first sign-in. Companies and invoices
        arrive in phase 1; see <code>docs/billing-app-plan/</code>.
      </p>
      <p>
        Sign in at <a href="/login">/login</a>; <a href="/dashboard">/dashboard</a> is the members
        page. Identity is the only thing shared with the other blackcode apps — one account, one
        password, one token.
      </p>
      <p style={{ fontSize: 13, marginTop: 32 }}>
        Agents work through the CLI: <code>bk login --server</code> this origin, then{' '}
        <code>bk billing workspace list</code>. Run <code>bk guide billing</code> for the rest.
      </p>
    </main>
  )
}

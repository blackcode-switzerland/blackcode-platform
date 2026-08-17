// The members page — **the screen the whole multi-app refactor is for**, and
// the one page this app has behind a login.
//
// ===========================================================================
// A SERVER COMPONENT IS NOT A ROUTE, AND THAT IS WHY THIS PAGE IS HERE
// ===========================================================================
// This page reads the database DIRECTLY. No `fetch`, no `/api/…`, no bearer
// token — just `listWorkspacesForUser` and `listWorkspaceMembers` from this
// app's own query layer.
//
// That is the shape that cost `apps/sales` four phases of being broken. Its
// `app/dashboard/[ws]/layout.tsx` resolved membership with the SHARED
// `listMyWorkspaces` against `platform.workspaces`; Phase 2 moved that app's
// workspaces into its own schema and repointed the sibling file one directory
// up, and missed this one. **The entire sales web UI 404'd for every sales-only
// account while every API route returned 200** — so five phases of route-level
// verification, three agents driving real HTTP with real tokens, and a CLI
// parity guard were all blind to it. It was found by opening a browser.
//
// Two rules come out of that, and they are why this page exists in a scaffold:
//
//   1. **When a phase changes where data lives, the pages that read it directly
//      are not covered by testing the API.** Open them.
//   2. A page like this must read THIS APP'S tables. `apps/sales`'
//      `lib/app-isolation.test.ts` now fails the build if a file this app serves
//      imports a platform TENANCY reader (`listMyWorkspaces`,
//      `getWorkspaceForUser`, `listWorkspaceMembers`, …) — copy that guard, not
//      just the intention.
//
// ===========================================================================
// NO DASHBOARD CHROME, AND THAT IS A DECISION
// ===========================================================================
// There is no shell, no theme, no nav, no query client and no toast library —
// this app depends on none of them. A scaffold that shipped a design is a design
// every copy has to undo, and the shared primitives are in
// `@blackcode/platform-ui` when you want them (`docs/frontend.md`).
//
// What it DOES ship is the loop that has to be right: sign up → land in a
// workspace you own → see your team → invite somebody → hand them a link.

import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { listWorkspaceMembers, listWorkspacesForUser } from '@/lib/db/queries/workspaces'
import { listInvitations } from '@/lib/db/queries/invitations'

// This page is per-request by construction (it reads the session), and saying so
// beats discovering at build time that Next tried to prerender it.
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  const mine = await listWorkspacesForUser(user.id)
  const ws = mine[mine.length - 1]

  // Reaching here with none means `ensureWorkspaceForUser` did not run or did
  // not finish. It is best-effort by design (a sign-in must not fail because a
  // workspace could not be minted), so this is the visible fallback rather than
  // an impossible state — and it says what to do instead of rendering an empty
  // page somebody has to debug.
  if (!ws) {
    return (
      <main style={{ fontFamily: 'system-ui', padding: 48, maxWidth: 640 }}>
        <h1>No workspace yet</h1>
        <p>
          Signing in should have created one. It is best-effort and idempotent, so signing out and
          back in retries it. If it keeps failing, check the server log for
          <code> ensureWorkspaceForUser failed at sign-in</code> — and look at the ROWS in{' '}
          <code>books.workspaces</code>, not at the status code, because that call never throws
          into a sign-in.
        </p>
      </main>
    )
  }

  const isOwner = ws.member_role === 'owner'
  const members = await listWorkspaceMembers(ws.id)
  // Owner-only, matching the route: a pending invitation carries a redeemable
  // token, so listing them is handing out access.
  const invitations = isOwner ? await listInvitations(ws.id) : []

  return (
    <main style={{ fontFamily: 'system-ui', padding: 48, maxWidth: 640 }}>
      <h1>{ws.name}</h1>
      <p>
        Signed in as {user.email}. You are the <strong>{ws.member_role}</strong> of this workspace.
      </p>

      <h2>Your team</h2>
      <ul>
        {members.map((m) => (
          <li key={m.user_id}>
            {m.name ?? m.email} — {m.role}
            {m.user_id === user.id && ' (you)'}
          </li>
        ))}
      </ul>

      {isOwner && (
        <>
          <h2>Pending invitations</h2>
          {invitations.length === 0 ? (
            <p>
              None. Invite somebody with <code>bk books invite send &lt;email&gt;</code>; the
              response carries the link, because this app sends no email.
            </p>
          ) : (
            <ul>
              {invitations.map((inv) => (
                <li key={inv.id}>
                  {inv.email} — invited by {inv.invited_by_name ?? inv.invited_by_email}
                  {/* The link, on every row. `apps/sales` shipped a members page
                      that said "copy the link and send it yourself" and showed
                      the link only until the next reload; after that the
                      invitation was unsendable from the UI even though the token
                      was already in the payload. */}
                  <br />
                  <code>/invitations/{inv.token}</code>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p style={{ marginTop: 32, fontSize: 13 }}>
        Accounts are shared across blackcode apps: removing somebody here does not close their
        account, and somebody invited here may already have one from another app.
      </p>
    </main>
  )
}

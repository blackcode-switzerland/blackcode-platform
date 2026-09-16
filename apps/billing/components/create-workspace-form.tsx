'use client'

// The one write this app's web surface makes in phase 0: create a workspace.
//
// ===========================================================================
// WHY THIS EXISTS AT ALL — IT IS PHASE 0'S RECORDED DECISION, ON SCREEN
// ===========================================================================
// `docs/2026-08-multi-app-refactor.md` §9.1: somebody arriving on a session
// cookie from another blackcode app has a valid session here and no workspace,
// because `ensureWorkspaceForUser` runs only in the sign-in callback and in
// `POST /api/auth/register`. Before this, their only way out was to sign out and
// back in — a dead end nobody would guess their way through.
//
// `docs/billing-app-plan/phase-0-register-the-app.md` lists three candidate
// answers and says phase 0 must pick one. This app picks the explicit act. The
// reasoning is in `lib/db/queries/createWorkspaceForUser`; the short version is
// that bootstrapping on first authenticated request would mean anyone holding a
// blackcode account for any reason silently acquires tenancy in the app that
// sends real payment slips.
//
// ── IT POSTS TO THE SAME ROUTE `bk` CALLS ──────────────────────────────────
// `POST /api/workspaces`, which is `bk billing workspace create`. Not a server
// action, and not a second implementation: CLAUDE.md's "start anywhere, finish
// in sync" is about exactly this, and a server action here would be a capability
// the CLI could not reach and the parity guard could not see.
import { useState } from 'react'

export function CreateWorkspaceForm() {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        // The server's `suggestion` is the recovery, and showing the raw code
        // instead would make the reader guess. Same contract the CLI prints as a
        // `hint:` line.
        const body = (await res.json().catch(() => null)) as
          | { message?: string; suggestion?: string }
          | null
        setError(
          [body?.message ?? `create failed (${res.status})`, body?.suggestion]
            .filter(Boolean)
            .join(' — ')
        )
        return
      }
      // A full reload rather than a router refresh: the page above is a server
      // component that read the session and the workspace list, and the whole
      // point is to re-run that read.
      window.location.reload()
    } catch {
      setError('could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 16 }}>
      <label htmlFor="ws-name" style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
        Workspace name
      </label>
      <input
        id="ws-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Acme SA"
        maxLength={80}
        required
        style={{ padding: '6px 8px', minWidth: 260, marginRight: 8 }}
      />
      <button type="submit" disabled={busy || name.trim().length === 0} style={{ padding: '6px 12px' }}>
        {busy ? 'Creating…' : 'Create workspace'}
      </button>
      {error && (
        <p role="alert" style={{ color: '#b00', fontSize: 13, marginTop: 8 }}>
          {error}
        </p>
      )}
    </form>
  )
}

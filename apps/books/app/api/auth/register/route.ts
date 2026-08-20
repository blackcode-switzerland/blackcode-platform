// POST /api/auth/register — self sign-up for this app.
//
// ===========================================================================
// THE WHITELIST GATE IS THE POINT OF THIS FILE. READ THIS BEFORE EDITING IT.
// ===========================================================================
// The account this route creates is the SHARED platform account — one
// `platform.users` row, valid against EVERY deployment, holding one password and
// able to mint API tokens for all of them.
//
// So **an ungated register route on any app is an ungated register route on
// every app**, `apps/issues` included. That is not a theoretical escalation: a
// person who signs up here gets no workspace anywhere by accident, but they get
// an IDENTITY, and identities are what invitations, tokens and the whitelist
// itself are keyed on.
//
// `isEmailAllowed` is the gate (`SUPER_ADMINS` + `platform.email_whitelist`),
// and multiAppFinalRefactor PLAN.md §6 decision 1 makes it non-negotiable for
// every app's sign-up. It is checked BEFORE any write, and before the existence
// check below — which also means a non-whitelisted address cannot use this route
// to find out whether somebody else already has an account.
//
// ── WHAT `isEmailAllowed` RETURNS WHEN NOTHING IS CONFIGURED ────────────────
// `true`. The whitelist is OFF when `SUPER_ADMINS` is unset, which is what keeps
// local development working — and is why `lib/auth/register-gate.test.ts`
// asserts against a CONFIGURED whitelist rather than against the default. An "it
// refused" that only happens because nothing was set up is CLAUDE.md finding
// #16: a denial from a subject that was never provisioned. That test puts the
// POSITIVE case first for the same reason.
//
// **Copy the gate with the route, and watch a non-whitelisted address be
// refused rather than reasoning that it would be.**
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT A SHARED FACTORY
// ---------------------------------------------------------------------------
// The response shapes, the error strings and the post-create side effects are an
// app's own — issues mints a workspace through `ensureDefaultWorkspace`, which
// also writes `issues.workspace_counters`. What IS shared is the part that must
// never diverge: the gate (`@blackcode/platform-auth`), the validators, and the
// INSERT itself (`createUserWithPassword` in `@blackcode/platform-db`).
//
// ---------------------------------------------------------------------------
// NOT REACHABLE FROM `bk`, AND THAT IS AN EXCLUSION WITH A REASON
// ---------------------------------------------------------------------------
// It is browser sign-up machinery: an agent authenticates with a `bk_live_…`
// token, which it can only have because a human already has an account. Listed
// in `lib/cli-parity.test.ts`'s EXCLUDED_PATHS, the same entry `apps/issues` and
// `apps/sales` carry.

import { NextRequest, NextResponse } from 'next/server'
import { createUserWithPassword, getUserByEmail } from '@blackcode/platform-db'
import {
  hashPassword,
  isEmailAllowed,
  validateEmail,
  validatePassword,
} from '@blackcode/platform-auth'
import { getDb } from '@/lib/db/client'
import { ensureWorkspaceForUser } from '@/lib/db/queries/workspaces'

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string; name?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''
  const name = body.name?.trim() || null

  const emailErr = validateEmail(email)
  if (emailErr) return NextResponse.json({ error: emailErr }, { status: 400 })

  const passwordErr = validatePassword(password)
  if (passwordErr) return NextResponse.json({ error: passwordErr }, { status: 400 })

  // THE GATE. Before any write, and before the existence check below.
  const allowed = await isEmailAllowed(getDb(), email)
  if (!allowed) {
    return NextResponse.json(
      {
        error: 'not_in_whitelist',
        message:
          'This app is invite-only. Ask a super admin to add your address, or ask ' +
          'a workspace owner to invite you.',
      },
      { status: 403 }
    )
  }

  const existing = await getUserByEmail(getDb(), email)
  if (existing) {
    return NextResponse.json(
      {
        error: 'Email already registered',
        suggestion: 'Sign in instead, or use a different email',
      },
      { status: 409 }
    )
  }

  try {
    const password_hash = await hashPassword(password)
    const user = await createUserWithPassword(getDb(), { email, password_hash, name })
    if (!user) return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })

    // A workspace, immediately, so the person lands in a working app rather than
    // on a "somebody has to invite you" screen — which is the whole difference
    // this phase makes. Best-effort: `lib/auth.ts` runs the same call on every
    // sign-in, so a failure here self-heals on their first login rather than
    // leaving them with an account they cannot use.
    try {
      await ensureWorkspaceForUser(user.id, user.name, user.email)
    } catch (wErr) {
      console.error('ensureWorkspaceForUser failed during register:', wErr)
    }

    return NextResponse.json({ id: user.id, email: user.email, name: user.name }, { status: 201 })
  } catch (error) {
    console.error('Register failed:', error)
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
  }
}

// POST /api/auth/register — self sign-up for b/sales.
//
// ===========================================================================
// THE WHITELIST GATE IS THE POINT OF THIS FILE. READ THIS BEFORE EDITING IT.
// ===========================================================================
// The account this route creates is the SHARED platform account — one
// `platform.users` row, valid against every deployment, holding one password and
// able to mint API tokens for all of them. So an ungated register route on sales
// is an ungated register route on `apps/issues` and on every app that comes
// after it.
//
// That is not a theoretical escalation. A person who signs up here gets no sales
// workspace by accident — they get an IDENTITY, and identities are what
// invitations, tokens and the whitelist itself are keyed on.
//
// `isEmailAllowed` is the gate (`SUPER_ADMINS` + `platform.email_whitelist`),
// and PLAN.md §6 decision 1 makes it non-negotiable for every app's sign-up.
// It is checked BEFORE any write. `lib/auth/register-gate.test.ts` watches it
// refuse; that test was watched failing by deleting this block.
//
// ── WHAT `isEmailAllowed` RETURNS WHEN NOTHING IS CONFIGURED ────────────────
// `true`. The whitelist is OFF when `SUPER_ADMINS` is unset, which is what keeps
// local development working — and is why the test asserts against a configured
// whitelist rather than against the default. An "it refused" that only happens
// because nothing was set up is finding #16 in `CLAUDE.md`: a denial from a
// subject that was never provisioned.
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
// in `lib/cli-parity.test.ts`'s EXCLUDED_PATHS, the same entry `apps/issues`
// carries.

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
    return NextResponse.json({ error: 'Invalid JSON body', code: 'invalid_body' }, { status: 400 })
  }

  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''
  const name = body.name?.trim() || null

  const emailErr = validateEmail(email)
  if (emailErr) return NextResponse.json({ error: emailErr, code: 'invalid_email' }, { status: 400 })

  const passwordErr = validatePassword(password)
  if (passwordErr)
    return NextResponse.json({ error: passwordErr, code: 'weak_password' }, { status: 400 })

  // THE GATE. Before any write, and before the existence check below — which
  // also means a non-whitelisted address cannot use this route to find out
  // whether somebody else already has an account.
  const allowed = await isEmailAllowed(getDb(), email)
  if (!allowed) {
    // `{ error, code, suggestion }` — the platform error envelope
    // (`packages/platform-api/src/errors.ts`), NOT the `{ error: '<code>',
    // message }` shape this route used to answer. It was changed on 2026-08-11
    // when the sign-up SCREEN was built and had to render the refusal: with the
    // old shape the honest thing to display was the string `not_in_whitelist`.
    // `error` is the human sentence, `code` is what a client branches on, and
    // `suggestion` is the recovery line — the same three fields `lib/client.ts`
    // already parses for every other route in this app.
    return NextResponse.json(
      {
        error: 'That address is not on the approved list, so an account cannot be created for it.',
        code: 'not_in_whitelist',
        suggestion:
          'Ask a super admin to add your address, or ask a workspace owner to invite you.',
      },
      { status: 403 }
    )
  }

  const existing = await getUserByEmail(getDb(), email)
  if (existing) {
    return NextResponse.json(
      {
        error: 'That email already has an account.',
        code: 'email_taken',
        suggestion: 'Sign in instead, or use a different email',
      },
      { status: 409 }
    )
  }

  try {
    const password_hash = await hashPassword(password)
    const user = await createUserWithPassword(getDb(), { email, password_hash, name })
    if (!user)
      return NextResponse.json(
        { error: 'Failed to create user', code: 'internal_error' },
        { status: 500 }
      )

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
    return NextResponse.json(
      { error: 'Failed to create user', code: 'internal_error' },
      { status: 500 }
    )
  }
}

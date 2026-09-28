// The frame every dashboard screen sits in.
//
// A slug in the URL is user input, so it is checked here rather than trusted:
// an unreachable one is a **404**, not a 403. A 403 confirms the row exists, and
// for one this person is not a member of, its existence is exactly the fact that
// must not leak. The API layer settles the same question the same way
// (`getWorkspaceForUser` returns null for both cases), so the two surfaces agree.
//
// ── IT READS THIS APP'S OWN TENANCY, AND THAT IS THE WHOLE LESSON ──────────
// `books.workspaces`, via this app's own query layer — never
// `platform.workspaces`, never a shared `listMyWorkspaces`. `apps/sales` had
// exactly this file pointed at the platform table for four phases: **its entire
// web UI 404'd for every sales-only account while every API route returned
// 200**, so five phases of route verification, three agents driving real HTTP,
// and a CLI parity guard were all blind to it. It was found by opening a
// browser. `lib/app-isolation.test.ts` fails the build if this file imports a
// platform tenancy reader; the guard is not a substitute for knowing why.

import { notFound, redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { listWorkspacesForUser } from '@/lib/db/queries/workspaces'
import { BooksShell } from '@/components/books-shell'

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ ws: string }>
}) {
  const { ws } = await params
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  const memberships = await listWorkspacesForUser(user.id)
  if (!memberships.some((w) => w.slug === ws)) notFound()

  // The list feeds the sidebar's workspace switcher (since 2026-09-28, when
  // decision D-C was reversed). Loaded here, by the same query that decided the
  // 404, so the switcher can never list a workspace the layout would refuse.
  // What the header switches between is still BOOKS, from `/api/meta`.
  return (
    <BooksShell ws={ws} workspaces={memberships}>
      {children}
    </BooksShell>
  )
}

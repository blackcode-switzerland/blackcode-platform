// The minimal test UI's frame: a row of links, nothing else. See lib/web.ts.
//
// No database read here. Membership is decided by every route the pages call
// (a non-member gets their 404), so this layout cannot let a page show data the
// API would refuse — it has none to show.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ ws: string }>
}) {
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')
  const { ws } = await params
  const base = `/dashboard/${encodeURIComponent(ws)}`
  const links: Array<[string, string]> = [
    ['overview', base],
    ['invoices', `${base}/invoices`],
    ['companies', `${base}/companies`],
    ['recurrences', `${base}/recurrences`],
    ['history', `${base}/history`],
  ]
  return (
    <div className="min-ui" style={{ fontFamily: 'system-ui' }}>
      {/* Just enough to undo Tailwind's reset so a person can see what is a
          button and what is a field. Scoped to this frame; the real design is
          the frontend tickets'. */}
      <style>{`
        .min-ui h1 { font-size: 22px; font-weight: 700; margin: 8px 0 12px }
        .min-ui h2 { font-size: 16px; font-weight: 600; margin: 20px 0 6px }
        .min-ui button { border: 1px solid #888; border-radius: 3px; padding: 2px 10px; background: #f3f3f3; margin: 4px 4px 4px 0; cursor: pointer }
        .min-ui button:disabled { opacity: .5 }
        .min-ui input, .min-ui select, .min-ui textarea { border: 1px solid #aaa; border-radius: 2px }
        .min-ui fieldset { border: 1px solid #ddd; padding: 6px 12px; max-width: 720px }
        .min-ui legend { font-weight: 600; padding: 0 4px }
        .min-ui a { color: #0645ad; text-decoration: underline }
        .min-ui th { background: #f6f6f6 }
      `}</style>
      <nav data-testid="nav" style={{ padding: '8px 24px', borderBottom: '1px solid #ccc', fontSize: 14 }}>
        <strong data-testid="nav-workspace">{ws}</strong>
        {links.map(([name, href]) => (
          <Link key={name} href={href} data-testid={`nav-${name}`} style={{ marginLeft: 16 }}>
            {name}
          </Link>
        ))}
        <Link href="/dashboard" style={{ marginLeft: 16 }}>
          workspaces
        </Link>
        <span style={{ float: 'right', color: '#666' }}>{user.email}</span>
      </nav>
      {children}
    </div>
  )
}

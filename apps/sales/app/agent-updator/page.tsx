// /agent-updator — where a stuck agent is sent. Every API response points
// here as `X-BK-Help` (lib/api.ts), and so do /llms.txt and the manifest
// embedded on every page. Added 2026-09-28 so this app has the same agent front
// door apps/issues has had since 2026-08-03; the path keeps issues' spelling
// (`updator`) because every app's headers must agree on it, and
// `next.config.js` sends the correct spelling here.
//
// Two audiences, one page: readable by a human AND scrapeable by an agent, so
// it is plain server-rendered HTML with nothing behind interaction. The
// commands come from lib/agent-manifest.ts, so this page cannot disagree with
// /llms.txt. Like the landing page, it names no vocabulary, limit or command
// beyond the few needed to start — `bk guide` is the reference.

import type { Metadata } from 'next'
import { getCliVersions } from '@blackcode/platform-agent'
import { SiteFrame } from '@/components/site-chrome'
import { AGENT_MANIFEST as m } from '@/lib/agent-manifest'

// Per request: the "Current:" line reads the CLI versions live from npm.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'For agents · b/sales',
  description:
    'How an AI agent operates b/sales through the bk CLI: what to install, where the answers live, and what to do when something stops working.',
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-foreground">
      <code>{children}</code>
    </pre>
  )
}

export default async function AgentUpdatorPage() {
  const cli = await getCliVersions()
  return (
    <SiteFrame>
      <article className="mx-auto max-w-3xl px-5 py-16 sm:px-6 sm:py-24">
        <header className="mb-12">
          <p className="text-xs font-medium uppercase tracking-wider text-primary">For agents</p>
          <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Operate b/sales from an agent.
          </h1>
          <p className="mt-4 text-muted-foreground">
            People use this web app; agents use <code>bk</code>, one Go binary on npm. There is
            no HTTP API to learn: the routes behind the web app are private plumbing with no
            public contract, and everything an agent needs is in the binary or one command away.
          </p>
        </header>

        <section className="mb-12">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">1 &middot; Start here</h2>
          <Code>{[m.install, ...m.start].join('\n')}</Code>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            <code>bk skill install</code> writes a short skill file that points your agent at the
            two sources below and holds no facts that can go stale.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">2 &middot; Where the answers live</h2>
          <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <li>
              <strong className="text-foreground">
                <code>bk guide</code>
              </strong>{' '}
              &mdash; how the tool behaves: every workflow, flag and failure mode. It ships inside
              the binary, so it describes exactly the version you are running, and it works
              offline.
            </li>
            <li>
              <strong className="text-foreground">
                <code>bk meta</code>
              </strong>{' '}
              &mdash; what the data is now: your workspaces, the current vocabularies and every
              limit the server enforces. Fetched live; never hardcode any of it.
            </li>
            <li>
              <code>--help</code> on any command, before calling it.
            </li>
          </ul>
        </section>

        <section className="mb-12 rounded-xl border border-primary/30 bg-primary/5 p-5">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">
            3 &middot; When something stops working
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Run <code>bk skill sync</code>, then retry. It refreshes the skill, and when the binary
            itself is behind it prints the exact upgrade command. What changed, and when, is in{' '}
            <code>bk changelog</code> (also <code>GET {m.changelog}</code>).
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Every API response carries <code>X-BK-CLI-Latest</code> and <code>X-BK-CLI-Min</code>.
            Below the minimum, <code>bk</code> refuses to run and prints the upgrade commands
            instead of failing with a cryptic error.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Current: CLI latest v{cli.latest} &middot; minimum supported v{cli.min}.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold tracking-tight">4 &middot; Update at any time</h2>
          <Code>{`npm install -g ${m.package}@latest\nbk skill install\nbk guide`}</Code>
        </section>
      </article>
    </SiteFrame>
  )
}

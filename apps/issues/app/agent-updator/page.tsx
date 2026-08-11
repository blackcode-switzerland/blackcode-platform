// The single canonical destination every migration signal points at: the
// `Warning` / `X-BK-Migration` response headers and the 410 stubs at
// /api/openapi.json and /api/docs all land here.
//
// Two audiences, one page. It must be readable by a human AND scrapeable by an
// agent, so everything is plain semantic HTML rendered on the server — no
// client-only rendering, no content hidden behind interaction. An agent that
// fetches this URL and reads the text has everything it needs.
//
// The commands come from lib/agent-manifest.ts so this page can never disagree
// with /llms.txt or the per-page manifest.

import type { Metadata } from 'next'
import { MarketingLayout } from '@/components/marketing/layout'
import { AGENT_MANIFEST as m } from '@/lib/agent-manifest'
import { CLI_LATEST_VERSION, CLI_MIN_VERSION } from '@blackcode/platform-agent'

export const metadata: Metadata = {
  title: 'The HTTP API is now CLI-only · b/issues',
  description:
    'blackcode issues is operated through the bk CLI. What changed, what to run, and where each piece of the old documentation went.',
}

const COMMANDS = [`${m.install}`, ...m.start].join('\n')

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs leading-relaxed text-foreground">
      <code>{children}</code>
    </pre>
  )
}

// Where each retired surface's knowledge went. This table is the reason an agent
// that was built against the old docs can re-orient in one read.
const MOVED: Array<[string, string, string]> = [
  ['/api/openapi.json', 'bk guide', 'How every command works, embedded in the binary you run.'],
  ['/api/docs', 'bk guide', 'Same content, same command.'],
  ['Platform Reference', 'bk guide', 'The pinned snapshot is gone; the guide is the surface.'],
  ['Per-page agent manifest', 'bk guide', 'The page manifest is now a four-line pointer.'],
  ['/api/meta', 'bk meta', 'Unchanged and still live — now also carries limits, media rules and CLI versions.'],
  ['/changelog (web page)', 'bk changelog', 'The page was removed; the dated record itself is unchanged and also at GET /api/changelog.'],
]

export default function AgentUpdatorPage() {
  return (
    <MarketingLayout>
      <article className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <header className="mb-12">
          <div className="text-xs font-medium uppercase tracking-wider text-primary">For agents</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            blackcode issues is now CLI-only
          </h1>
        </header>

        {/* 1 — What changed, in two sentences. */}
        <section className="mb-12">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">1 &middot; What changed</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            The <code>bk</code> CLI is now the only supported way to operate blackcode issues
            programmatically. The HTTP API behind it is private plumbing with no public contract:
            the OpenAPI spec, the browsable API reference and the fat per-page manifest have all
            been retired.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            The reason is drift. The same facts used to be written down in seven places that had to
            agree, and they stopped agreeing &mdash; which is exactly the failure that breaks an
            agent mid-run. Now there are two sources, and neither can go stale:{' '}
            <strong className="text-foreground">
              <code>bk guide</code>
            </strong>{' '}
            ships inside the binary you are running, and{' '}
            <strong className="text-foreground">
              <code>bk meta</code>
            </strong>{' '}
            is fetched live.
          </p>
        </section>

        {/* 2 — What to do. */}
        <section className="mb-12">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">2 &middot; What to do</h2>
          <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
            Four commands, in this order:
          </p>
          <Code>{COMMANDS}</Code>
          <ul className="mt-4 space-y-2 text-sm leading-relaxed text-muted-foreground">
            <li>
              <code>bk skill install</code> writes a ~30-line skill file into{' '}
              <code>./.claude/skills/blackcode-issues/</code> (or <code>~/.claude/</code>). It
              contains no facts that can rot &mdash; only pointers. Use{' '}
              <code>--format agents-md</code> to write into <code>AGENTS.md</code> instead.
            </li>
            <li>
              <code>bk guide</code> is the complete usage guide for the binary you just installed.
              It works offline and unauthenticated, so it is also what you run when everything else
              is failing. <code>bk guide --list</code> for topics, <code>bk guide --json</code> for
              structured output.
            </li>
            <li>
              <code>bk meta</code> returns your workspaces, the live status/priority/health
              vocabularies, and every server-enforced limit. Never hardcode these.
            </li>
            <li>
              Later, if anything drifts: <code>bk skill sync</code>. That is the one command to
              remember. It refreshes the skill, and when the binary itself is behind it prints the
              exact upgrade command and exits <code>9</code>.
            </li>
          </ul>
        </section>

        {/* 3 — Nothing is broken yet. */}
        <section className="mb-12 rounded-lg border border-primary/30 bg-primary/5 p-5">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">3 &middot; Nothing is broken</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            <strong className="text-foreground">No route was removed or changed.</strong> Every
            existing HTTP integration keeps working today. What has been withdrawn is the
            documentation and the support promise &mdash; so there is no hard cutover and no window
            where your automation is stuck with no path forward.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Direct HTTP callers now receive <code>Warning</code> and <code>X-BK-Migration</code>{' '}
            headers on every response. There is no sunset date &mdash; the routes stay where they
            are; they are simply no longer a surface we document or support. Requests made through{' '}
            <code>bk</code> are not warned &mdash; the CLI is the supported interface.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            <code>GET /api/openapi.json</code> and <code>GET /api/docs</code> now answer{' '}
            <code>410 Gone</code> with a <code>suggestion</code> field naming the fix, so an agent
            can recover in the same run.
          </p>
        </section>

        {/* 4 — Where the old information went. */}
        <section className="mb-12">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">
            4 &middot; Where the old information went
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border/60 bg-muted/30">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium text-foreground">Was</th>
                  <th scope="col" className="px-4 py-2.5 font-medium text-foreground">Now</th>
                  <th scope="col" className="px-4 py-2.5 font-medium text-foreground">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {MOVED.map(([was, now, note]) => (
                  <tr key={was}>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{was}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-foreground">{now}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 5 — Version floor. */}
        <section>
          <h2 className="mb-3 text-lg font-semibold tracking-tight">5 &middot; Version floor</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Every API response carries <code>X-BK-CLI-Latest</code> (newest published) and{' '}
            <code>X-BK-CLI-Min</code> (oldest still supported). Below the minimum, <code>bk</code>{' '}
            refuses to run &mdash; exit code <code>8</code>, with the upgrade commands printed
            &mdash; rather than failing with cryptic 404s. A <code>bk</code> older than 1.9.0 has no{' '}
            <code>guide</code> or <code>skill</code> commands and therefore no way to find its own
            way back, so the floor was raised to 1.9.0 when that release shipped. If your{' '}
            <code>bk</code> stops running, that is what happened &mdash; upgrade and re-run{' '}
            <code>bk skill install</code>.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Current: CLI latest v{CLI_LATEST_VERSION} &middot; minimum supported v{CLI_MIN_VERSION}.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Update at any time:
          </p>
          <Code>{`npm install -g ${m.package}@latest\nbk skill install\nbk guide`}</Code>
        </section>
      </article>
    </MarketingLayout>
  )
}

// /agent-updator — where a stuck agent is sent. Every API response points
// here as `X-BK-Help` (lib/api.ts), and so do /llms.txt and the manifest
// embedded on every page. Added 2026-09-28 so this app has the same agent front
// door apps/issues has had since 2026-08-03; the path keeps issues' spelling
// (`updator`) because every app's headers must agree on it, and
// `next.config.js` sends the correct spelling here.
//
// Plain server-rendered HTML, readable by a human and scrapeable by an agent.
// Every sentence is a dictionary key (`lib/dictionary/marketing.ts`, EN + FR,
// `lib/hardcoded-strings.test.ts`); command names are interpolated, never
// translated. The commands in the code blocks come from lib/agent-manifest.ts,
// so this page cannot disagree with /llms.txt.

import type { Metadata } from 'next'
import { getCliVersions } from '@blackcode/platform-agent'
import { SiteFrame } from '@/components/site-chrome'
import { AGENT_MANIFEST as m } from '@/lib/agent-manifest'
import { serverT } from '@/lib/i18n-server'

// Per request: the "current" line reads the CLI versions live from npm.
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT()
  return { title: t('agents.metaTitle'), description: t('agents.metaDescription') }
}

// The two places an agent's answers live. The command is a spelling, never
// translated; only the sentence after it is copy.
const SOURCES = [
  { command: 'bk guide', body: 'agents.guideBody' },
  { command: 'bk meta', body: 'agents.metaBody' },
] as const

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-foreground">
      <code>{children}</code>
    </pre>
  )
}

export default async function AgentUpdatorPage() {
  const [t, cli] = await Promise.all([serverT(), getCliVersions()])
  return (
    <SiteFrame>
      <article className="mx-auto max-w-3xl px-5 py-16 sm:px-6 sm:py-24">
        <header className="mb-12">
          <p className="text-xs font-medium uppercase tracking-wider text-primary-strong">
            {t('agents.eyebrow')}
          </p>
          <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {t('agents.title')}
          </h1>
          <p className="mt-4 text-muted-foreground">{t('agents.intro', { bk: 'bk' })}</p>
        </header>

        <section className="mb-12">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">{t('agents.startTitle')}</h2>
          <Code>{[m.install, ...m.start].join('\n')}</Code>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            {t('agents.startBody', { skill: 'bk skill install' })}
          </p>
        </section>

        <section className="mb-12">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">{t('agents.answersTitle')}</h2>
          <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            {SOURCES.map((s) => (
              <li key={s.command}>
                <code className="font-semibold text-foreground">{s.command}</code> — {t(s.body)}
              </li>
            ))}
            <li>{t('agents.helpBody', { help: '--help' })}</li>
          </ul>
        </section>

        <section className="mb-12 rounded-xl border border-primary/30 bg-primary/5 p-5">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">{t('agents.stuckTitle')}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t('agents.stuckBody', {
              sync: 'bk skill sync',
              changelog: 'bk changelog',
              route: `GET ${m.changelog}`,
            })}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {t('agents.floorBody', {
              latestHeader: 'X-BK-CLI-Latest',
              minHeader: 'X-BK-CLI-Min',
              bk: 'bk',
            })}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            {t('agents.current', { latest: cli.latest, min: cli.min })}
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold tracking-tight">{t('agents.updateTitle')}</h2>
          <Code>{`npm install -g ${m.package}@latest\nbk skill install\nbk guide`}</Code>
        </section>
      </article>
    </SiteFrame>
  )
}

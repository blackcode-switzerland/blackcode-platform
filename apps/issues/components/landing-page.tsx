import Link from 'next/link'
import {
  ArrowRight,
  BookOpen,
  Boxes,
  CheckCircle2,
  Download,
  Files,
  Hash,
  Inbox,
  KeyRound,
  Layers,
  Moon,
  Sparkles,
  Tag,
  Terminal,
  Trash2,
  Users,
  Workflow,
  Zap,
} from 'lucide-react'

import { MarketingLayout } from '@/components/marketing/layout'
import { BrowserFrame } from '@/components/marketing/browser-frame'
import { Button } from '@blackcode/platform-ui/ui/button'
import { Badge } from '@blackcode/platform-ui/ui/badge'
import { Card, CardContent } from '@blackcode/platform-ui/ui/card'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@blackcode/platform-ui/ui/accordion'
import { cn } from "@blackcode/platform-ui/utils"

type FeatureStatus = 'live' | 'preview' | 'soon'

interface Feature {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  status: FeatureStatus
}

// Every card here describes something that ships today (or is tagged "in
// preview"). Speculative / not-yet-built work is intentionally left off.
const FEATURES: Feature[] = [
  {
    icon: Hash,
    title: 'Integer IDs',
    description:
      '"Issue 42" is easier to dictate, easier to grep, and easier for a model to keep in working memory than a 36-character UUID. Each workspace numbers its issues from #1.',
    status: 'live',
  },
  {
    icon: Layers,
    title: 'Kanban board',
    description:
      'Drag-and-drop columns per status — backlog, todo, in progress, done, cancelled. Moves persist instantly with optimistic updates.',
    status: 'live',
  },
  {
    icon: Workflow,
    title: 'Timeline & list views',
    description:
      'A Gantt-style timeline places issues and projects on a date axis from their start and due dates. Switch to a dense list when you just want rows.',
    status: 'live',
  },
  {
    icon: Files,
    title: 'Rich-text issues & comments',
    description:
      'A TipTap editor with a slash menu, bubble toolbar, headings, lists, checklists, code blocks, links, @mentions and inline media. Sanitized before save.',
    status: 'live',
  },
  {
    icon: Boxes,
    title: 'File attachments',
    description:
      'Paste, drag, or attach any file type (SVG excluded for safety) up to 100 MB. Stored on Vercel Blob in production, on the local disk in development.',
    status: 'live',
  },
  {
    icon: Tag,
    title: 'Labels & tasks',
    description:
      'Workspace-wide labels with colors, and tasks that stand alone or belong to a project — each with its own issues, comments and progress.',
    status: 'live',
  },
  {
    icon: Users,
    title: 'Teams & roles',
    description:
      'Invite by email. Workspaces have owners and members, with owner-only gates on destructive actions; projects add their own roles (owner, admin, member, viewer).',
    status: 'live',
  },
  {
    icon: Inbox,
    title: 'Activity feed & inbox',
    description:
      'Every mutation is recorded on an append-only event spine that powers a workspace activity feed and a per-user inbox of mentions, assignments and changes.',
    status: 'live',
  },
  {
    icon: Sparkles,
    title: 'Workspace analytics',
    description:
      'Snapshot counts, completion rate, cycle time, velocity and aging — sliced by status, priority, assignee, label and project, plus per-task burndown.',
    status: 'live',
  },
  {
    icon: KeyRound,
    title: 'API tokens for scripts',
    description:
      'Mint a bk_live_… token in settings. Stored as a SHA-256 hash with a short visible prefix so you know which one is which; optional expiry and one-click revoke.',
    status: 'live',
  },
  {
    icon: BookOpen,
    title: 'Self-describing CLI',
    description:
      '`bk guide` is the complete usage guide, embedded in the binary — so it always describes the version you are running, offline and unauthenticated. `bk meta` returns your context, the valid vocabulary and every limit in one call.',
    status: 'live',
  },
  {
    icon: Trash2,
    title: 'Trash & restore',
    description:
      'Deleting an issue, project or task moves it to a recoverable Trash. Restore brings items back as a group; owners can purge or empty the bin.',
    status: 'live',
  },
  {
    icon: Moon,
    title: 'Dark mode by default',
    description:
      'Token-driven theming with next-themes. Dark out of the box; flip the entire app’s accent by changing one CSS variable.',
    status: 'live',
  },
  // ── THE "Reversible edits" CARD WAS REMOVED ON 2026-08-11 ─────────────────
  // It advertised `bk undo` over a journal of before/after snapshots. There was
  // never such a journal: `platform.transaction_log` had no writer, which is why
  // `bk undo` was removed in CLI 1.12.0 and `/api/undo` is a 410 — read that
  // route's header. multiAppFinalRefactor Phase 5 then DROPPED the table.
  //
  // So this card described a capability that did not exist, on a public page,
  // under a `preview` pill that made "not working yet" the reading. Trash and
  // restore is the real version of the promise and has its own card above.
  //
  // Do not reinstate it without a writer for the journal.
]

function StatusPill({ status, className }: { status: FeatureStatus; className?: string }) {
  const map: Record<FeatureStatus, { label: string; className: string }> = {
    live: {
      label: 'Live',
      className:
        'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400',
    },
    preview: {
      label: 'In preview',
      className:
        'bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300',
    },
    soon: {
      label: 'Coming soon',
      className:
        'bg-primary/10 text-primary ring-primary/20',
    },
  }
  const { label, className: c } = map[status]
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-full border-0 px-2.5 py-0.5 text-[11px] font-medium ring-1',
        c,
        className,
      )}
    >
      {label}
    </Badge>
  )
}

export function LandingPage() {
  return (
    <MarketingLayout>
      <Hero />
      <Surfaces />
      <Features />
      <CommandLine />
      <HowItWorks />
      <ForAgents />
      <FAQ />
      <FinalCTA />
    </MarketingLayout>
  )
}

/* ---------- Sections ---------- */

function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      {/* Two decorative layers: the brand-tinted radial glow, then a faded grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: 'var(--hero-glow)' }}
      />
      <div
        aria-hidden
        className="bg-grid pointer-events-none absolute inset-0 -z-10"
      />

      <div className="mx-auto max-w-7xl px-6 pt-20 pb-16 text-center sm:pt-28">
        <div className="mx-auto mb-7 inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 pl-1 text-xs text-muted-foreground shadow-sm">
          <span className="rounded-full bg-primary px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-primary-foreground">
            New
          </span>
          Working alpha — one data model, a web UI and a CLI
        </div>
        <h1 className="mx-auto max-w-3xl text-balance text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
          Issue tracking for humans
          <br className="hidden sm:block" /> and the{' '}
          <span className="text-gradient-brand">AI working</span> alongside them.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
          Integer IDs. A CLI written in Go that documents itself.
          A web UI built like Linear. One data model behind both.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/login?tab=signup">
              Get started — it&rsquo;s free
              <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="#cli">
              <Terminal />
              Try the CLI
            </Link>
          </Button>
        </div>

        <div className="relative mx-auto mt-16 max-w-6xl">
          <BrowserFrame
            srcDark="/hero-dark.png"
            srcLight="/hero-light.png"
            alt="Screenshot of the Blackcode Issues dashboard"
            url="app.blackcode.issues/dashboard"
            width={2880}
            height={1800}
          />
        </div>
      </div>
    </section>
  )
}

function Surfaces() {
  const surfaces = [
    {
      icon: Boxes,
      title: 'Web UI',
      copy:
        'Kanban, timeline, list, and issue detail with rich text. The clicky surface, polished with Tailwind v4 and shadcn/ui.',
      meta: '→ /dashboard',
    },
    {
      icon: Terminal,
      title: (
        <>
          CLI <span className="text-muted-foreground">(bk)</span>
        </>
      ),
      copy:
        'A single Go binary on npm. Table, JSON, or YAML output. Stable exit codes. bk login opens a browser; you’re authed in seconds.',
      meta: '→ bk issues issue list --json',
    },
    {
      icon: Zap,
      title: 'Agent skill',
      copy:
        '`bk skill install` writes a ~30-line skill file your coding agent reads. It holds no facts that can rot — only pointers to `bk guide` and `bk meta` — so it never goes stale, and `bk skill sync` repairs it when anything does.',
      meta: '→ bk skill install',
    },
  ]
  return (
    <section className="border-t border-border/60">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
        <SectionHead
          eyebrow="Two surfaces"
          title="Web for humans. CLI for agents. Same data."
          sub="Anything you can do in the web app, an agent can do with bk — and an automated parity test fails the build if a capability ever exists in one and not the other."
        />
        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {surfaces.map((s, i) => (
            <Card key={i} className="group transition-colors hover:border-primary/50">
              <CardContent className="flex flex-col gap-3 p-6">
                <div className="inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <s.icon className="size-5" />
                </div>
                <h3 className="text-lg font-semibold">{s.title}</h3>
                <p className="text-sm text-muted-foreground">{s.copy}</p>
                <div className="mt-1 font-mono text-xs text-muted-foreground/80">
                  {s.meta}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

function Features() {
  return (
    <section className="border-t border-border/60 bg-muted/30">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
        <SectionHead
          eyebrow="Feature catalog"
          title="The boring stuff, done well."
          sub="Status is labeled on every card so you know what’s shipped today and what’s still warming up."
        />
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card
              key={f.title}
              className="group h-full transition-colors hover:border-primary/40"
            >
              <CardContent className="flex h-full flex-col gap-3 p-6">
                <div className="flex items-center justify-between">
                  <div className="inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <f.icon className="size-5" />
                  </div>
                  <StatusPill status={f.status} />
                </div>
                <h3 className="text-base font-semibold">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

function CommandLine() {
  const points = [
    {
      title: 'One binary, every platform',
      copy:
        'The npm package ships a tiny installer that downloads the right prebuilt Go binary for your OS and architecture (macOS, Linux, Windows · amd64/arm64).',
    },
    {
      title: 'Browser login, token storage',
      copy:
        'bk login runs a loopback OAuth handshake — approve in the browser and a bk_live_… token is saved to ~/.config/bk/config.json (mode 0600).',
    },
    {
      title: 'Built for scripts and agents',
      copy:
        '--json / -o yaml for machine-readable output, cursor pagination, and stable exit codes (0 ok … 7 aborted). Set BK_NO_PROMPT=1 to skip confirmations.',
    },
    {
      title: 'Everything the UI can do',
      copy:
        'issues, projects, tasks, comments, labels, members, invites, inbox, trash, analytics, and undo — all from the terminal.',
    },
  ]
  return (
    <section id="cli" className="border-t border-border/60">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
        <SectionHead
          eyebrow="Command line"
          title="Install the CLI in one line."
          sub="bk is a single Go binary distributed on npm. Same features as the web app — scriptable, pipeable, and ready for agents."
        />
        <div className="mt-12 grid gap-5 lg:grid-cols-2 lg:items-start">
          <CodeBlock
            label="Quickstart"
            lang="bash"
            code={`# 1. install (npm fetches the prebuilt binary for your platform)
$ npm install -g @blackcode_sa/bc-issues

# 2. authenticate — opens your browser, done in seconds
$ bk login --server https://your-deployment.app

# 3. pick a workspace — each app has its own, so the app names itself
$ bk issues workspace use my-team

# 4. work
$ bk issues issue list --status todo
$ bk issues issue create --project 1 --title "Fix signup bug" --priority 1
$ bk issues issue list --json | jq '.data[].title'`}
          />
          <div className="flex flex-col gap-4">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-mono text-xs text-muted-foreground">
              <Download className="size-3.5" />
              npm i -g @blackcode_sa/bc-issues
            </div>
            <ul className="space-y-4">
              {points.map((p) => (
                <li key={p.title} className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary/70" />
                  <div>
                    <h4 className="text-sm font-semibold">{p.title}</h4>
                    <p className="mt-0.5 text-sm text-muted-foreground">{p.copy}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground/80">
              Tip: run <span className="font-mono">bk --help</span> for the full
              command tree, or <span className="font-mono">bk whoami</span> to
              confirm you’re signed in.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function HowItWorks() {
  const bullets = [
    {
      title: 'Same auth everywhere',
      copy:
        'Bearer token or session cookie — pick one per request. The backend resolves the user the same way regardless of which surface you came from.',
    },
    {
      title: 'One data model',
      copy:
        'Postgres with Drizzle ORM. Integer primary keys, indexed where they matter, single round-trip per route. Every tenant lives under a workspace.',
    },
    {
      title: 'Reversible by design',
      copy:
        'Deletes soft-delete to a recoverable Trash rather than vanishing, and items removed together come back together. Purging is a second, separate decision — so a wrong delete is something you notice and undo, not something you discover later.',
    },
    {
      title: 'Predictable failures',
      copy:
        'Stable exit codes to branch on, and a `hint:` line on stderr that names the fix — a renamed flag, an upgrade, `bk skill sync` — so a stuck run can recover itself instead of stopping.',
    },
  ]
  return (
    <section id="how" className="border-t border-border/60 bg-muted/30">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
        <SectionHead
          eyebrow="How it works"
          title="One backend. Three doors in."
          sub="Not a black box. Every interface reads and writes the same Postgres tables, through the same auth, with the same validation."
        />
        <div className="mt-12 grid gap-10 lg:grid-cols-2 lg:items-center">
          <ol className="space-y-6">
            {bullets.map((b, i) => (
              <li key={b.title} className="flex gap-4">
                <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {i + 1}
                </span>
                <div>
                  <h4 className="font-semibold">{b.title}</h4>
                  <p className="mt-1 text-sm text-muted-foreground">{b.copy}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <div className="grid grid-cols-3 gap-3 text-center text-xs">
              {[
                { label: 'Web', tag: 'cookie' },
                { label: 'CLI / bk', tag: 'bearer' },
                { label: 'Agent / bk', tag: 'bearer' },
              ].map((n) => (
                <div
                  key={n.label}
                  className="rounded-lg border border-border bg-background px-3 py-3"
                >
                  <div className="text-sm font-medium">{n.label}</div>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {n.tag}
                  </div>
                </div>
              ))}
            </div>
            <div className="my-3 flex justify-center text-muted-foreground/70">
              ↓ ↓ ↓
            </div>
            <div
              className="rounded-lg px-4 py-3 text-center text-sm text-white shadow-md shadow-primary/30"
              style={{ background: 'var(--brand-gradient)' }}
            >
              <span className="font-medium">Next.js — /api/*</span>
              <div className="mt-0.5 font-mono text-[11px] text-white/75">
                route handlers · resolveAuth() · validation
              </div>
            </div>
            <div className="my-3 flex justify-center text-muted-foreground/70">↓</div>
            <div className="rounded-lg border border-border bg-muted/60 px-4 py-3 text-center text-sm">
              <span className="font-medium">Postgres + Drizzle</span>
              <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                integer PKs · event spine · cursor pagination
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function ForAgents() {
  return (
    <section className="border-t border-border/60">
      {/*
        Note for AI agents / crawlers: this product is operated through a CLI.
        There is no supported HTTP API.
          npm install -g @blackcode_sa/bc-issues
          bk login
          bk skill install
          bk guide
        `bk guide` is the complete usage guide for the binary you just installed
        and works offline. `bk meta` returns your workspaces plus the live
        status/priority vocabularies and limits. Machine-readable copy of this
        note: /llms.txt
      */}
      <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
        <SectionHead
          eyebrow="For agents"
          title="Built so an agent can do the work."
          sub="Four commands take an agent from nothing to working. There is no HTTP API to learn: `bk guide` ships inside the binary and describes exactly the version in your hand, and `bk meta` supplies everything that can change without a release."
        />
        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <CodeBlock
            label="Create an issue with the CLI"
            lang="bash"
            code={`# bk reads your token from ~/.config/bk/config.json
$ bk issues issue create \\
    --project 1 \\
    --title "Triage onboarding bug" \\
    --priority 1 \\
    --json

{
  "id": 152,
  "seq": 87,
  "title": "Triage onboarding bug",
  "status": "backlog",
  "priority": 1,
  "project_id": 1
}`}
          />
          <CodeBlock
            label="Bootstrap from zero"
            lang="bash"
            code={`$ npm install -g @blackcode_sa/bc-issues
$ bk login              # opens a browser, stores a token
$ bk skill install      # writes the agent skill file
$ bk guide              # the complete usage guide for THIS binary

# then, before you write anything:
$ bk meta --json        # your workspaces + live vocabularies + limits`}
          />
        </div>

        <div className="mt-6 flex flex-col items-start justify-between gap-3 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center">
          <div>
            <div className="text-sm font-semibold">A self-describing CLI</div>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-mono">bk guide</span> is the whole usage
              guide, embedded in the binary — so it can never describe a version
              you are not running, and it works with no network and no token.
              One call to <span className="font-mono">bk meta</span> returns the
              active workspace plus the exact status, priority and health values
              to use, and every server-enforced limit — so an agent never has to
              guess.
            </p>
          </div>
          <StatusPill status="live" />
        </div>
      </div>
    </section>
  )
}

function FAQ() {
  const items: { q: string; a: string }[] = [
    {
      q: 'How does an agent discover what it can do?',
      a: 'It runs `bk guide` — the complete usage guide, embedded in the binary, so it always matches the version being run and works offline. Then `bk meta` for the live data: your workspaces, the valid status/priority/health values, and every server-enforced limit. Flags come from `bk <group> <command> --help`. Nothing has to be guessed or cached.',
    },
    {
      q: 'Is there an HTTP API?',
      a: 'Not a public one. The CLI is the only supported interface; the HTTP routes behind it are private plumbing with no contract, and the OpenAPI spec has been retired. This is deliberate: the same facts used to be maintained in seven places that had to agree, and drift between them is exactly what breaks an agent mid-run. Existing HTTP integrations still work — see /agent-updator for the migration.',
    },
    {
      q: 'How do I install and use the CLI?',
      a: 'npm install -g @blackcode_sa/bc-issues, then bk login (it opens a browser and stores a token in ~/.config/bk/config.json), bk issues workspace use <slug>, and you’re working: bk issues issue list, bk issues issue create --project 1 --title "…". Run bk --help for the full command tree.',
    },
    {
      q: 'How do agents and scripts authenticate?',
      a: 'Run `bk login` — it opens a browser and stores the token in ~/.config/bk/config.json. For headless setups, mint a token at /dashboard/settings/tokens and pipe it in: echo \"$TOKEN\" | bk login --token. Tokens carry optional expiry and can be revoked from the same page.',
    },
    {
      q: 'Is the CLI scriptable for automation and CI?',
      a: 'Yes. Add --json or -o yaml for machine-readable output, pipe it through jq, and branch on stable exit codes (0 ok, 3 unauthenticated, 4 forbidden, 5 not found, 6 validation, 7 aborted). Set BK_NO_PROMPT=1 to skip confirmations in unattended runs.',
    },
    {
      q: 'How does pagination work?',
      a: 'Most lists return everything in one response. Only the keyset feeds paginate — bk issues activity, bk issues trash list and bk super-admin errors list — via --limit / --cursor, following next_cursor until it is null. Run `bk guide output` for the details.',
    },
    {
      q: 'What happens when I delete something?',
      a: 'Issues, projects and tasks soft-delete into a recoverable Trash rather than vanishing. Items deleted together restore as a group; workspace owners can purge selected items or empty the bin. Purging is deliberately a second decision — run bk issues trash list to see what is in there.',
    },
    {
      q: 'Can a team and its agents share a workspace?',
      a: 'Yes. Everything is workspace-scoped with members and roles; every change lands on a shared activity feed and a per-user inbox of mentions and assignments — so humans and agents working the same board stay in sync.',
    },
    {
      q: 'What stack does the project use?',
      a: 'Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui, NextAuth, TanStack Query and Framer Motion on the front; Postgres + Drizzle ORM on the server; Go for the CLI.',
    },
  ]
  return (
    <section className="border-t border-border/60">
      <div className="mx-auto max-w-3xl px-6 py-20 sm:py-24">
        <SectionHead
          eyebrow="FAQ"
          title="Frequently asked."
          sub=""
          align="left"
        />
        <Accordion type="single" collapsible className="mt-10 w-full">
          {items.map((it, i) => (
            <AccordionItem key={i} value={`item-${i}`}>
              <AccordionTrigger className="text-left">{it.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                {it.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}

function FinalCTA() {
  return (
    <section className="border-t border-border/60">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
        <div
          className="relative isolate overflow-hidden rounded-3xl p-10 text-center sm:p-14"
          style={{ background: 'var(--brand-gradient)' }}
        >
          {/* White grid overlay, faded toward the edges */}
          <div
            aria-hidden
            className="bg-grid-on-brand pointer-events-none absolute inset-0"
          />
          <div className="relative">
            <h2 className="text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Ready to give your agents an inbox?
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-white/85">
              Create an account, mint a token, and start moving work through the same
              system you do.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="bg-white text-slate-900 shadow-lg hover:bg-white/95"
              >
                <Link href="/login?tab=signup">
                  Get started — it&rsquo;s free
                  <ArrowRight />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
              >
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ---------- Small helpers ---------- */

function SectionHead({
  eyebrow,
  title,
  sub,
  align = 'center',
}: {
  eyebrow: string
  title: string
  sub?: string
  align?: 'center' | 'left'
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        align === 'center' ? 'items-center text-center' : 'items-start text-left',
      )}
    >
      <span className="text-xs font-medium uppercase tracking-wider text-primary">
        {eyebrow}
      </span>
      <h2 className="max-w-3xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {sub ? (
        <p className="max-w-2xl text-balance text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  )
}

function CodeBlock({
  label,
  lang,
  code,
}: {
  label: string
  lang: string
  code: string
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2.5 text-xs">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="font-mono text-muted-foreground/70">{lang}</span>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[12.5px] leading-relaxed text-foreground">
        {code}
      </pre>
    </div>
  )
}

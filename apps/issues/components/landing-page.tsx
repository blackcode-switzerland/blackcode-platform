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

// ===========================================================================
// THE TEST EVERY LINE ON THIS PAGE HAS TO PASS
// ===========================================================================
// **Would this become false if somebody changed the product and never opened
// this file?** If yes, it does not belong here. Nothing on a marketing page is
// covered by typecheck, lint, a test or a build — prose is the one surface in
// this repo with no guard at all, which is why `bk undo` was advertised here
// for months over a journal that never had a writer.
//
// In practice that rules out four things, and they were all here on 2026-08-11:
//
//   1. **Vocabularies and enum values.** The status list, the project role list,
//      a priority number in an example. `bk meta` serves those live, precisely
//      because a page cannot.
//   2. **Limits and counts.** "up to 100 MB", "SVG excluded", the exit-code
//      table. Declared once in `lib/limits.ts` / `cmd/bk/main.go` and served or
//      embedded; a second copy here is a copy that drifts.
//   3. **`bk` commands beyond the two or three needed to get started.** Every
//      one is a claim that a spelling still exists. `bk guide` ships inside the
//      binary and therefore cannot drift; this page points at it.
//   4. **Capabilities rather than benefits.** A capability can be removed. What
//      the product is FOR cannot, and a reader wants that anyway.
//
// Say what a person gets. Let `bk guide` and `bk meta` say what the tool does.
const FEATURES: Feature[] = [
  {
    icon: Hash,
    title: 'Issues you can say out loud',
    description:
      '"Issue 42" is easier to dictate, easier to grep, and easier for a model to hold in working memory than a 36-character UUID. Every workspace numbers its own.',
    status: 'live',
  },
  {
    icon: Layers,
    title: 'Board, timeline, list',
    description:
      'The same issues as a drag-and-drop board, as a date axis, or as dense rows — whichever one answers the question you are holding. Moves persist as you make them.',
    status: 'live',
  },
  {
    icon: Files,
    title: 'Write like it matters',
    description:
      'Headings, checklists, code blocks, tables, links and @mentions in every description and comment, with a slash menu to reach them. Sanitized before it is stored.',
    status: 'live',
  },
  {
    icon: Boxes,
    title: 'Attach the evidence',
    description:
      'Paste, drag or attach a file straight into an issue or a comment. The screenshot that explains the bug lives beside the bug.',
    status: 'live',
  },
  {
    icon: Tag,
    title: 'Labels, tasks, projects',
    description:
      'Group work the way your team already talks about it — a label across a workspace, a task that stands alone or belongs to a project, each with its own issues and progress.',
    status: 'live',
  },
  {
    icon: Users,
    title: 'A team, and its agents',
    description:
      'Invite by email into a shared workspace. The destructive actions are gated, and the gate is the same whether a person or an agent is asking.',
    status: 'live',
  },
  {
    icon: Inbox,
    title: 'Nothing happens silently',
    description:
      'Every change lands on an append-only spine that feeds a workspace activity feed and a personal inbox — so an agent working overnight is something you can read in the morning.',
    status: 'live',
  },
  {
    icon: Sparkles,
    title: 'Analytics that answer',
    description:
      'Completion, cycle time, velocity and aging, sliced by the things you already file work under. Built from the same rows the board draws, not a separate pipeline.',
    status: 'live',
  },
  {
    icon: KeyRound,
    title: 'Tokens for unattended work',
    description:
      'Mint a token in settings for a script, a CI job or an agent. It is stored hashed, carries an optional expiry, and revoking it takes one click.',
    status: 'live',
  },
  {
    icon: BookOpen,
    title: 'A CLI that describes itself',
    description:
      '`bk guide` is the complete usage guide, embedded in the binary — so it can never describe a version you are not running, and it works offline. `bk meta` supplies everything that changes without a release.',
    status: 'live',
  },
  {
    icon: Trash2,
    title: 'A wrong delete is not a lost one',
    description:
      'Deleting moves work to a recoverable Trash, and things deleted together come back together. Emptying it is a second, separate decision.',
    status: 'live',
  },
  {
    icon: Moon,
    title: 'Dark by default',
    description:
      'Token-driven theming, dark out of the box, light when you want it. It follows you across both surfaces.',
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
  //
  // ── AND ON THE SAME DAY, THE SAME DEFECT IN FIVE MORE CARDS ──────────────
  // "Kanban board" printed the whole status vocabulary; "File attachments"
  // printed a size cap and a blocked MIME type; "Teams & roles" printed the
  // project role vocabulary; "Workspace analytics" and "API tokens" described
  // implementation. None of them was wrong on the day it was written, and every
  // one of them was a fact with a second home. They were rewritten as benefits,
  // which is the only kind of sentence a marketing page can keep true.
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
            alt="Screenshot of the b/issues dashboard"
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
        'A single Go binary on npm. Table, JSON or YAML output, stable exit codes, and a browser login that takes seconds.',
      meta: '→ bk guide',
    },
    {
      icon: Zap,
      title: 'Agent skill',
      copy:
        'One command writes a short skill file your coding agent reads. It holds no facts that can rot — only pointers to the guide and the live data — so it never goes stale.',
      meta: '→ bk skill install',
    },
  ]
  return (
    <section className="border-t border-border/60">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
        <SectionHead
          // "Two surfaces" over three cards until 2026-08-11. The third is the
          // agent skill, which is not a surface — it is a pointer file telling
          // an agent to use the second one.
          eyebrow="Two surfaces, one of them scriptable"
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
        'Machine-readable output, cursor pagination, and stable exit codes to branch on — so an unattended run can tell "nothing found" from "not allowed" without parsing English.',
    },
    {
      title: 'Everything the UI can do',
      copy:
        'A parity test fails the build if a capability exists on one surface and not the other. `bk guide` lists what that means today, for the binary in your hand.',
    },
    // ── WHAT THESE TWO SAID UNTIL 2026-08-11 ────────────────────────────────
    // The first printed the exit-code table (`0 ok … 7 aborted`), which lives in
    // `cmd/bk/main.go` and is the CLI's contract — a second copy on a web page
    // is a copy nobody updates. The second listed eleven command groups and
    // ended with **`undo`**, a verb removed in CLI 1.12.0 whose route has been a
    // 410 ever since. That is the same card, the same sentence and the same
    // month as the `bk undo` FEATURE card removed above: a list of capabilities
    // is a list of things that can quietly stop being true.
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
            // THREE COMMANDS, AND EVERY ONE OF THEM WAS RUN BEFORE IT WAS PUT
            // HERE (2026-08-11). It was six, and two of the six carried enum
            // values in their flags (`--status todo`, `--priority 1`) — the
            // vocabulary `bk meta` serves live and a page cannot.
            //
            // `workspace use` is not optional padding: without an active
            // workspace `bk issues issue list` exits 2 with
            // "no active workspace", which is the first thing a reader
            // following this block would have hit.
            //
            // Anything past these three belongs in `bk guide`, which ships
            // inside the binary and therefore describes the version being run.
            code={`# 1. install (npm fetches the prebuilt binary for your platform)
$ npm install -g @blackcode_sa/bc-issues

# 2. authenticate — opens your browser, done in seconds
$ bk login

# 3. pick a workspace, then work
$ bk issues workspace use my-team
$ bk issues issue list`}
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
              Everything past these three is in{' '}
              <span className="font-mono">bk guide</span>, which ships inside the
              binary — so it describes the version you just installed, not this
              page&rsquo;s memory of it.
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
          // "Three doors in" over a grid whose second and third box were both
          // `bk` holding the same bearer token. There are two.
          title="One backend. Two doors in."
          sub="Not a black box. Both interfaces read and write the same Postgres tables, through the same auth, with the same validation."
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
            <div className="grid grid-cols-2 gap-3 text-center text-xs">
              {[
                { label: 'Web', tag: 'cookie' },
                { label: 'bk — you or an agent', tag: 'bearer' },
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
          bk guide
        `bk guide` is the complete usage guide for the binary you just installed
        and works offline; it names every other command, including the one that
        installs the agent skill file. `bk meta` returns the live data — your
        workspaces, the valid vocabularies, every server-enforced limit — which
        is deliberately NOT restated here or anywhere else that can go stale.
        Machine-readable copy of this note: /llms.txt
      */}
      <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
        <SectionHead
          eyebrow="For agents"
          title="Built so an agent can do the work."
          sub="Three commands take an agent from nothing to working. There is no HTTP API to learn: `bk guide` ships inside the binary and describes exactly the version in your hand, and `bk meta` supplies everything that can change without a release."
        />
        {/* ── ONE BLOCK, NOT TWO, SINCE 2026-08-11 ────────────────────────────
            The one that went was "Create an issue with the CLI": a `bk issues
            issue create` invocation carrying `--priority 1` and a response body
            printing `"status": "backlog"`. Both are the live vocabulary, which
            is `bk meta`'s job — a page that prints an enum value is a page that
            is wrong the first time somebody adds one. And the point it was
            making ("an agent can do the work") is made better by the block that
            stayed, which is the only one a reader has to type. */}
        <div className="mt-12 grid gap-5">
          <CodeBlock
            label="Bootstrap from zero"
            lang="bash"
            code={`$ npm install -g @blackcode_sa/bc-issues
$ bk login              # opens a browser, stores a token
$ bk guide              # the complete usage guide for THIS binary`}
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
      a: 'It runs `bk guide` — the complete usage guide, embedded in the binary, so it always matches the version being run and works offline. Then `bk meta` for the live data: its workspaces, the valid vocabularies, and every server-enforced limit. Nothing has to be guessed or cached.',
    },
    {
      q: 'Is there an HTTP API?',
      a: 'Not a public one. The CLI is the only supported interface; the HTTP routes behind it are private plumbing with no contract, and the OpenAPI spec has been retired. This is deliberate: the same facts used to be maintained in seven places that had to agree, and drift between them is exactly what breaks an agent mid-run. Existing HTTP integrations still work — see /agent-updator for the migration.',
    },
    // ── FIVE ANSWERS WERE PRUNED HERE ON 2026-08-11 ────────────────────────
    // Between them they printed the exit-code table, the three commands that
    // happen to paginate, a settings URL, and four more `bk` spellings with
    // their flags. All four kinds are facts with a home that cannot drift —
    // `cmd/bk/main.go`, `bk guide output`, the app itself — and a copy on a
    // marketing page is a copy nobody will update. What is left says what is
    // true and names where to look.
    {
      q: 'How do I install and use the CLI?',
      a: 'npm install -g @blackcode_sa/bc-issues, then bk login — it opens a browser and stores a token. From there `bk guide` is the complete usage guide for the binary you just installed, offline and unauthenticated.',
    },
    {
      q: 'How do agents and scripts authenticate?',
      a: 'The same `bk login` a person runs. For headless setups — CI, an unattended agent — mint a token in your settings and pipe it into `bk login --token` instead of opening a browser. Tokens carry an optional expiry and can be revoked at any time.',
    },
    {
      q: 'Is the CLI scriptable for automation and CI?',
      a: 'That is what it is for. Machine-readable output, cursor pagination on the feeds that need it, and stable exit codes so an unattended run can tell "not allowed" from "nothing there" without parsing English. Run `bk guide` for the specifics of the version you have.',
    },
    {
      q: 'What happens when I delete something?',
      a: 'Work soft-deletes into a recoverable Trash rather than vanishing, and things deleted together come back together. Emptying the bin is deliberately a second, separate decision.',
    },
    {
      q: 'Can a team and its agents share a workspace?',
      a: 'Yes. Everything is workspace-scoped with members and roles; every change lands on a shared activity feed and a per-user inbox of mentions and assignments — so humans and agents working the same board stay in sync.',
    },
    {
      q: 'What stack does the project use?',
      a: 'Next.js (App Router) + TypeScript + Tailwind + shadcn/ui, NextAuth and TanStack Query on the front; Postgres + Drizzle ORM on the server; Go for the CLI.',
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

// This app's front door for a signed-out visitor.
//
// Rebuilt 2026-09-28 on the shape apps/sales, apps/books and apps/billing
// share — hero, "what you do with it", the agent door, a closing call — so the
// four apps read as one family. The old page (centred hero, browser-frame
// mock-up, feature catalogue, FAQ) is in git history.
//
// ===========================================================================
// THE TEST EVERY LINE ON THIS PAGE HAS TO PASS
// ===========================================================================
// **Would this become false if somebody changed the product and never opened
// this file?** If yes, it does not belong here. Nothing on a marketing page is
// covered by typecheck, lint, a test or a build — prose is the one surface in
// this repo with no guard at all, which is why `bk undo` was advertised here
// for months over a journal that never had a writer.
//
//   1. **No vocabularies or enum values.** `bk meta` serves those live.
//   2. **No limits or counts.** Declared once in `lib/limits.ts` and served.
//   3. **No `bk` command beyond the few needed to start.** Every one is a claim
//      that a spelling still exists; `bk guide` ships inside the binary.
//   4. **Benefits, not capabilities.** A capability can be removed. What the
//      product is FOR cannot.
//
// COLOUR: Tailwind tokens only, from this app's theme (`app/globals.css`).
import Link from 'next/link'
import { ArrowRight, BookOpen, Hash, Inbox, Layers, Trash2, Users } from 'lucide-react'
import { CLI_NPM_PACKAGE } from '@blackcode/platform-agent'
import { SiteFrame } from '@/components/site-chrome'

export function LandingPage() {
  return (
    <SiteFrame nav={<HeaderNav />}>
      <Hero />
      <WhatItIsFor />
      <ForAgents />
      <FinalCTA />
    </SiteFrame>
  )
}

function HeaderNav() {
  return (
    <>
      <Link
        href="/login"
        className="rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        Sign in
      </Link>
      <Link
        href="/login?tab=signup"
        className="rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        Create an account
      </Link>
    </>
  )
}

/* -------------------------------------------------------------- sections -- */

function Hero() {
  return (
    <section className="mx-auto max-w-5xl px-5 pb-16 pt-20 sm:px-6 sm:pt-28">
      <p className="text-xs font-medium uppercase tracking-wider text-primary">
        AI-native issue tracking
      </p>
      <h1 className="mt-4 max-w-3xl text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
        Issue tracking for humans and the AI working alongside them.
      </h1>
      <p className="mt-5 max-w-2xl text-balance text-lg text-muted-foreground">
        b/issues keeps projects, tasks and issues in one workspace that people work
        in through the browser and agents work in through a CLI — the same data,
        the same numbers, and every change on the record.
      </p>
      <div className="mt-9 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/login?tab=signup"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Create an account
          <ArrowRight size={16} />
        </Link>
        <Link
          href="/login"
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-5 py-3 text-sm font-medium transition-colors hover:bg-accent"
        >
          Sign in
        </Link>
      </div>
    </section>
  )
}

function WhatItIsFor() {
  const items = [
    {
      icon: Hash,
      title: 'Issues you can say out loud',
      copy:
        '"Issue 42" is easier to dictate, easier to grep, and easier for a model to hold in working memory than a 36-character UUID. Every workspace numbers its own.',
    },
    {
      icon: Layers,
      title: 'Board, timeline, list',
      copy:
        'The same issues as a drag-and-drop board, as a date axis, or as dense rows — whichever one answers the question you are holding.',
    },
    {
      icon: Users,
      title: 'A team, and its agents',
      copy:
        'Invite by email into a shared workspace. The destructive actions are gated, and the gate is the same whether a person or an agent is asking.',
    },
    {
      icon: Inbox,
      title: 'Nothing happens silently',
      copy:
        'Every change feeds a workspace activity feed and a personal inbox — so an agent working overnight is something you can read in the morning.',
    },
    {
      icon: BookOpen,
      title: 'Write like it matters',
      copy:
        'Headings, checklists, code blocks, tables, attachments and @mentions in every description and comment, with a slash menu to reach them.',
    },
    {
      icon: Trash2,
      title: 'A wrong delete is not a lost one',
      copy:
        'Deleting moves work to a recoverable trash, and things deleted together come back together. Emptying it is a second, separate decision.',
    },
  ]
  return (
    <section className="border-t border-border bg-muted/40">
      <div className="mx-auto max-w-5xl px-5 py-16 sm:px-6 sm:py-20">
        <h2 className="max-w-2xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          What you do with it.
        </h2>
        <div className="mt-10 grid gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <div key={it.title}>
              <span className="inline-flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <it.icon size={18} />
              </span>
              <h3 className="mt-3.5 text-[15px] font-semibold">{it.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{it.copy}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function ForAgents() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-5xl px-5 py-16 sm:px-6 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-primary">
              Agent-first
            </p>
            <h2 className="mt-4 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              The terminal is not a second-class door.
            </h2>
            <p className="mt-4 text-muted-foreground">
              b/issues is operated by people in this web app and by agents through{' '}
              <span className="font-mono text-foreground">bk</span>, one Go binary on
              npm. There is no HTTP API to learn and no reference to keep in sync:{' '}
              <span className="font-mono text-foreground">bk guide</span> ships inside
              the binary, so it describes exactly the version you are running,
              offline.
            </p>
            <p className="mt-4 text-muted-foreground">
              Anything that changes without a release — statuses, priorities, limits,
              which workspace you are in — comes from{' '}
              <span className="font-mono text-foreground">bk meta</span>, live. That is
              why none of it is printed on this page.
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2.5 text-xs">
              <span className="font-medium text-muted-foreground">From zero</span>
              <span className="font-mono text-muted-foreground/70">bash</span>
            </div>
            {/* Every command here is one this app actually carries — do not
                extend this list. `bk guide issues/items` is the reference. */}
            <pre className="overflow-x-auto p-5 font-mono text-[12.5px] leading-relaxed">
              {`$ npm install -g ${CLI_NPM_PACKAGE}
$ bk login
$ bk issues workspace use <your-workspace>
$ bk issues issue list`}
            </pre>
          </div>
        </div>
      </div>
    </section>
  )
}

function FinalCTA() {
  return (
    <section className="border-t border-border bg-muted/40">
      <div className="mx-auto max-w-5xl px-5 py-16 text-center sm:px-6 sm:py-20">
        <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          Start tracking.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          Sign in with your blackcode account — the same one every blackcode app uses.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/login?tab=signup"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Create an account
            <ArrowRight size={16} />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-xl border border-border px-5 py-3 text-sm font-medium transition-colors hover:bg-accent"
          >
            Sign in
          </Link>
        </div>
      </div>
    </section>
  )
}

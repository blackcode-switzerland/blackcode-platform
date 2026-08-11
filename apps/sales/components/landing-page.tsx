// b/sales' front door.
//
// ===========================================================================
// THIS PAGE OVERTURNS A WRITTEN DECISION, AND THE PREMISE IS WHY
// ===========================================================================
// `app/page.tsx` was a bare redirect to `/dashboard`, above a comment that said
// there is no marketing page and there should not be one, because "b/sales is
// internal, nobody arrives here without being invited".
//
// That was true when it was written and stopped being true on 2026-08-11, when
// this app grew self-signup: `POST /api/auth/register` mints a workspace and
// `components/login-form.tsx` finally links to it. Somebody who is sent the bare
// URL now CAN get in on their own, and what they used to meet was an instant
// bounce to a login screen that told them nothing about what they were signing
// into. The decision changed because its premise did, not because it was
// ignored — see the note left in `app/page.tsx`.
//
// ===========================================================================
// WHAT MAY NOT BE ON IT — the same rule apps/issues' landing page now carries
// ===========================================================================
// **Would this become false if somebody changed the product and never opened
// this file?** Prose is the one surface in this repo with no guard on it at all:
// not tsc, not eslint, not a test, not the build. `apps/issues` advertised
// `bk undo` here for months over a journal that never had a writer, and this
// app's own login page told people to "ask a workspace owner to grant you
// b/sales" after that mechanism had been deleted.
//
// Concretely, and these are the ones this app will be tempted by:
//
//   1. **No stage, channel or objection names.** They are `lib/pipeline.ts`'s,
//      served live by `bk meta`, and they can gain a value without a deploy —
//      so a page that prints the ladder is wrong the first time somebody adds a
//      rung. There is therefore no pipeline diagram here with real labels on it.
//   2. **No limits or counts.** `lib/limits.ts` declares them once and
//      `/api/meta` serves them.
//   3. **No `bk` command past the three needed to start**, and all three were
//      RUN on 2026-08-11 before being written down. Everything else is in
//      `bk guide`, which ships inside the binary and cannot drift.
//   4. **No claims about access or invitations.** That is the sentence this app
//      already got wrong once.
//
// ===========================================================================
// COLOUR
// ===========================================================================
// Not one hex is typed here — `lib/palette.test.ts` scans this directory and
// D-4 is that every colour in this app is decided in `lib/pipeline.ts`. A
// landing page needs none of them: it is Tailwind tokens from the shared theme,
// which is where sales' warm neutrals and emerald primary already live. That is
// also why this page cannot be mistaken for the issues one without a single
// deliberate difference being written down.

import Link from 'next/link'
import {
  ArrowRight,
  CalendarClock,
  Building2,
  MessagesSquare,
  Package,
  Terminal,
  Workflow,
} from 'lucide-react'
import { SiteFrame } from '@/components/site-chrome'

// The header and footer that used to be defined in this file moved to
// `components/site-chrome.tsx` on 2026-08-11, unchanged, so that `/login` could
// wear them too. Read that file's header for why they were extracted rather
// than copied.
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
        Business development
      </p>
      <h1 className="mt-4 max-w-3xl text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
        Every deal, and the one thing you owe it next.
      </h1>
      <p className="mt-5 max-w-2xl text-balance text-lg text-muted-foreground">
        b/sales is where blackcode keeps its pipeline: the companies we are
        talking to, what was said, what was sent, and what is still owed. It opens
        on the work, not on a dashboard.
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
      {/* No screenshot. `apps/issues` ships hero-light.png / hero-dark.png and
          this app has none — and a stand-in image, a mocked-up pipeline or a
          borrowed one would all be a picture of something that does not exist.
          The plan that asked for this page said it in one line: make real ones
          or design without. This designs without. */}
    </section>
  )
}

function WhatItIsFor() {
  const items = [
    {
      icon: Building2,
      title: 'A company, not a contact record',
      copy:
        'Each prospect is one page: who we are talking to there, where the conversation has got to, what it is worth, and who owns it.',
    },
    {
      icon: CalendarClock,
      title: 'Meetings that leave something behind',
      copy:
        'What was agreed, what was objected to, and the next action with a date on it — recorded where the next person to open the deal will find it.',
    },
    {
      icon: MessagesSquare,
      title: 'Every thread in one place',
      copy:
        'Calls, mail and messages logged against the company they belong to, so history survives somebody being on holiday.',
    },
    {
      icon: Package,
      title: 'What we actually sell',
      copy:
        'A catalog of offerings, the documents that go out with them, and the templates the team reuses instead of rewriting.',
    },
    {
      icon: Workflow,
      title: 'One question on the way in',
      copy:
        'The first screen is what is owed today and what has gone quiet — not a chart of how last quarter went.',
    },
    {
      icon: Terminal,
      title: 'Readable by the agents you run',
      copy:
        'Everything a person can do here, an agent can do from the terminal, against the same records and the same permissions.',
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
              b/sales is operated by people in this web app and by agents through{' '}
              <span className="font-mono text-foreground">bk</span>, one Go binary
              on npm. There is no HTTP API to learn and no reference to keep in
              sync: <span className="font-mono text-foreground">bk guide</span>{' '}
              ships inside the binary, so it describes exactly the version you are
              running, offline.
            </p>
            <p className="mt-4 text-muted-foreground">
              Anything that changes without a release — the pipeline vocabulary,
              the limits, which workspace you are in — comes from{' '}
              <span className="font-mono text-foreground">bk meta</span>, live.
              That is why none of it is printed on this page.
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2.5 text-xs">
              <span className="font-medium text-muted-foreground">From zero</span>
              <span className="font-mono text-muted-foreground/70">bash</span>
            </div>
            {/*
              THREE COMMANDS, EACH RUN AGAINST A REAL DEPLOYMENT ON 2026-08-11
              BEFORE IT WAS WRITTEN HERE.

              `workspace use` is not filler: without an active workspace,
              `bk sales prospect list` exits 2 with "no active workspace", which
              is precisely what a reader following this block would hit.

              Do not extend this list. Every command printed on a web page is a
              claim that a spelling still exists, and the page is not covered by
              any check in this repo. `bk guide` is.
            */}
            <pre className="overflow-x-auto p-5 font-mono text-[12.5px] leading-relaxed">
              {`$ npm install -g @blackcode_sa/bc-issues
$ bk login
$ bk sales workspace use <your-workspace>
$ bk sales prospect list`}
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
          Open the pipeline.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          Sign in with your blackcode account — the same one b/issues uses.
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

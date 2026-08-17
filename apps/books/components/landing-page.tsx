// b/books' front door.
//
// ===========================================================================
// WHY THIS EXISTS AT ALL — decision D-E
// ===========================================================================
// `app/page.tsx` was literal scaffold text reading "Template app". Books has
// self-signup (`POST /api/auth/register` mints a workspace before it answers),
// so somebody sent the bare URL can get in on their own — and what they met was
// a page describing a scaffold. `apps/sales` grew a landing page for exactly
// this reason on 2026-08-11 and its header records the argument; the same
// premise holds here.
//
// ===========================================================================
// WHAT MAY NOT BE ON IT
// ===========================================================================
// **Would this become false if somebody changed the product and never opened
// this file?** Prose is the one surface in this repo with no guard on it at all:
// not tsc, not eslint, not a test, not the build. `apps/issues` advertised
// `bk undo` here for months over a journal that never had a writer.
//
// Concretely, and these are the ones THIS app will be tempted by:
//
//   1. **No vocabulary values.** Recognition states, evidence tiers, source
//      statuses — all served live by `/api/meta` and all able to gain a value
//      without a deploy. A page that prints the four evidence tiers is wrong the
//      first time somebody adds a fifth.
//   2. **No numbers.** Not the VAT rates (they changed on 01.01.2024 and will
//      change again), not a count of books, not a size limit. Every one of them
//      has a single source and `/api/meta` serves it.
//   3. **No `bk` command.** `apps/sales` prints three and its comment says each
//      was RUN against a real deployment before being written down. I cannot
//      make that claim here: `bk books` has one entity verb today (`note`) and
//      it is a phase-0 placeholder scheduled for deletion. So this page names
//      the binary and points at `bk guide`, which ships inside it and cannot
//      drift, and prints no spelling at all.
//   4. **No claims about access or invitations.** That is the sentence sales
//      already got wrong once.
//   5. **No legal advice, and no promise of compliance.** This is a tool for
//      keeping books that can be defended; it does not certify that they are.
//      The articles named below (957, 958f, 959a) are cited as what the product
//      is SHAPED by, which is a fact about the software.
//
// ===========================================================================
// COLOUR
// ===========================================================================
// Not one hex is typed here. Tailwind tokens from the shared theme, which is
// where this app's cream neutrals and ledger gold already live (D-B). Entity
// accents and vocabulary colours are user data and API data respectively, and
// neither belongs on a page that renders before anybody has signed in.

import Link from 'next/link'
import {
  ArrowRight,
  BookOpen,
  FileCheck2,
  Landmark,
  ScanSearch,
  Scale,
  Terminal,
} from 'lucide-react'
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
        className="rounded-md px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        Sign in
      </Link>
      <Link
        href="/login?tab=signup"
        className="rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
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
      <p className="text-xs font-medium uppercase tracking-wider text-primary-strong">
        Statutory bookkeeping
      </p>
      <h1 className="mt-4 max-w-3xl text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
        Books you can defend, line by line.
      </h1>
      <p className="mt-5 max-w-2xl text-balance text-lg text-muted-foreground">
        b/books keeps double-entry accounts for as many books as you have. Every
        entry says what it means, what evidence stands behind it, and where that
        evidence lives — because in ten years&rsquo; time that is the only thing
        anybody will ask.
      </p>
      <div className="mt-9 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/login?tab=signup"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Create an account
          <ArrowRight size={16} />
        </Link>
        <Link
          href="/login"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-5 py-3 text-sm font-medium transition-colors hover:bg-accent"
        >
          Sign in
        </Link>
      </div>
      {/* No screenshot. `apps/issues` ships hero-light.png / hero-dark.png; this
          app has none, and a mocked-up ledger would be a picture of numbers that
          are not real — on the front door of an accounting product. Design
          without, until there is a real one. */}
    </section>
  )
}

function WhatItIsFor() {
  const items = [
    {
      icon: BookOpen,
      title: 'One book, or several',
      copy:
        'A company, a second company, a self-employment activity — each is its own set of books with its own chart, its own year and its own balance. Switching between them is one control, not one login.',
    },
    {
      icon: ScanSearch,
      title: 'Every entry is explained',
      copy:
        'The bank text a transaction arrived with is never overwritten. What the entry MEANS is recorded beside it, along with whether that was recognised automatically or decided by a person.',
    },
    {
      icon: FileCheck2,
      title: 'Evidence is a first-class field',
      copy:
        'What document stands behind an entry, and what that document is good for, are recorded per entry — and the two legal consequences, profit tax and input VAT, are tracked separately because they are separate.',
    },
    {
      icon: Scale,
      title: 'The statements are the statute',
      copy:
        'Balance sheet and income statement in the order art. 959a and 959b CO give, with the wording they give. Lines that are zero this year still appear, because the list is the law and not a view of the data.',
    },
    {
      icon: Landmark,
      title: 'Where the money actually comes from',
      copy:
        'A register of every bank, card, processor and document feed, and whether each one is current. A gap in a feed is a gap in the books, and it is shown as one.',
    },
    {
      icon: Terminal,
      title: 'Driven by the agents you run',
      copy:
        'Ingest, matching and reconciliation happen outside this app. What you get here is the ledger, the reasoning behind it, and the small number of decisions that need a person.',
    },
  ]
  return (
    <section className="border-t border-border bg-muted/40">
      <div className="mx-auto max-w-5xl px-5 py-16 sm:px-6 sm:py-20">
        <h2 className="max-w-2xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          What it does.
        </h2>
        <div className="mt-10 grid gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <div key={it.title}>
              <span className="inline-flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary-strong">
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
        <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-primary-strong">
              Agent-first
            </p>
            <h2 className="mt-4 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              The work happens outside. This is where you check it.
            </h2>
            <p className="mt-4 text-muted-foreground">
              b/books is operated by people in this web app and by agents through{' '}
              <span className="font-mono text-foreground">bk</span>, one Go binary
              on npm. There is no HTTP API to learn and no reference to keep in
              sync: <span className="font-mono text-foreground">bk guide</span>{' '}
              ships inside the binary, so it describes exactly the version you are
              running, offline.
            </p>
            <p className="mt-4 text-muted-foreground">
              Anything that changes without a release — the vocabularies, the VAT
              rates, which books you have — comes from{' '}
              <span className="font-mono text-foreground">bk meta</span>, live.
              That is why none of it is printed on this page.
            </p>
            <p className="mt-4 text-muted-foreground">
              There is no chat box here and no assistant in the corner. Judgement
              belongs to the agent that does the ingest, or to you; this app&rsquo;s
              job is to show you what was decided and let you change it.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="text-[15px] font-semibold">What the law asks of a set of books</h3>
            <dl className="mt-4 space-y-3.5 text-sm">
              <div>
                <dt className="font-medium text-foreground">art. 957 CO — who must keep them</dt>
                <dd className="mt-0.5 text-muted-foreground">
                  A company keeps full double-entry accounts. There is no turnover
                  threshold that lets one out.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">art. 958f CO — for how long</dt>
                <dd className="mt-0.5 text-muted-foreground">
                  Ten years, and a digital copy counts only if its integrity can be
                  shown. That is why documents are referenced with a hash taken at
                  capture rather than uploaded.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">
                  art. 959a / 959b CO — what they must look like
                </dt>
                <dd className="mt-0.5 text-muted-foreground">
                  A fixed structure, in a fixed order. The balance sheet and income
                  statement here are that structure, not a report built on top of it.
                </dd>
              </div>
            </dl>
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
          Open the books.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          Sign in with your blackcode account — the same one the other blackcode
          apps use.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/login?tab=signup"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Create an account
            <ArrowRight size={16} />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-lg border border-border px-5 py-3 text-sm font-medium transition-colors hover:bg-accent"
          >
            Sign in
          </Link>
        </div>
      </div>
    </section>
  )
}

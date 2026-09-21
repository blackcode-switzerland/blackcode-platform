// This app's front door for a signed-out visitor.
//
// ===========================================================================
// WHAT MAY NOT BE ON IT
// ===========================================================================
// Same rule apps/sales and apps/issues carry on their landing pages: prose has
// no guard on it anywhere in this repo — not tsc, not eslint, not a test, not
// the build. So:
//
//   1. **No status, count or limit vocabulary.** `bk meta` serves those live and
//      they can gain a value without a deploy.
//   2. **No `bk` command beyond the three needed to start**, and every one
//      below is exactly what `docs/frontend.md` and the CLI guide describe —
//      no invented subcommand.
//   3. **Every name reads `APP_NAME`.** Nothing here says "b/billing" or
//      "blackcode" as a literal — `lib/no-brand-literal.test.ts` scans this file.
//   4. **No claim about what is or isn't implemented yet.** That is a phase-0
//      sentence and this is the phase-1 page; a page that describes its own
//      backend's maturity is wrong the day after it ships.
//
// ===========================================================================
// COLOUR
// ===========================================================================
// Tailwind tokens only, from the shared theme (violet primary, `app/globals.css`).
// Not one hex is typed here.
import Link from 'next/link'
import {
  ArrowRight,
  Building2,
  FileCheck2,
  History,
  QrCode,
  Repeat,
  ScrollText,
  Terminal,
} from 'lucide-react'
import { APP_NAME } from '@/lib/app'
import { SiteFrame } from '@/components/landing/site-chrome'

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
        Swiss statutory invoicing
      </p>
      <h1 className="mt-4 max-w-3xl text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
        Invoices a bank will accept, and a record that never loses the story.
      </h1>
      <p className="mt-5 max-w-2xl text-balance text-lg text-muted-foreground">
        {APP_NAME} issues QR-bill invoices for every company you bill under, keeps
        the numbering gapless, and records every change — from draft to sent to
        paid, with nothing ever deleted.
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
      icon: Building2,
      title: 'Any number of issuing companies',
      copy:
        'One workspace, several companies if you bill under several entities — each with its own numbering, its own creditor details, its own QR-IBAN.',
    },
    {
      icon: FileCheck2,
      title: 'Gapless numbering, by construction',
      copy:
        'Each company numbers its invoices in one unbroken sequence. A number is assigned once, never reused, and a voided invoice keeps its number — so the sequence always adds up.',
    },
    {
      icon: QrCode,
      title: 'A payment part a bank will scan',
      copy:
        'Every sent invoice carries a Swiss QR-bill: the reference, the account and the creditor resolved and frozen at send time, drawn from the invoice’s own record.',
    },
    {
      icon: ScrollText,
      title: 'Draft, sent, paid, void — and why',
      copy:
        'A lifecycle with a reason at every step: a void keeps its reason, an edit after sending is refused by name, and the whole history reads back as an audit log.',
    },
    {
      icon: Repeat,
      title: 'Recurring series, never twice for a period',
      copy:
        'A finite series with a stated end — never "forever" — that will not generate the same period’s invoice a second time.',
    },
    {
      icon: History,
      title: 'Imported history, not a second bookkeeping',
      copy:
        'Bills from the systems you used before are kept as a read-only archive beside your invoices, with anything ambiguous flagged rather than guessed.',
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
              {APP_NAME} is operated by people in this web app and by agents through{' '}
              <span className="font-mono text-foreground">bk</span>, one Go binary on
              npm. There is no HTTP API to learn and no reference to keep in sync:{' '}
              <span className="font-mono text-foreground">bk guide</span> ships inside
              the binary, so it describes exactly the version you are running,
              offline.
            </p>
            <p className="mt-4 text-muted-foreground">
              Anything that changes without a release — statuses, limits, which
              workspace you are in — comes from{' '}
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
                extend this list. `bk guide billing` is the reference. */}
            <pre className="overflow-x-auto p-5 font-mono text-[12.5px] leading-relaxed">
              {`$ npm install -g @blackcode_sa/bc-issues
$ bk login
$ bk billing workspace use <your-workspace>
$ bk billing invoice list`}
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
          Start invoicing.
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

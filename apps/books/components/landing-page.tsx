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

'use client'

// (Marked `'use client'` on 2026-08-20. It renders no state and never did — it
// is here because it calls `useT()`, and the alternative was `serverT()` plus
// threading a translator through six nested section components. A static page in
// the client bundle costs a few KB; a prop drilled through six components costs
// the next person who adds a seventh.)

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
import { useT } from '@/lib/i18n'

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
  const t = useT()
  return (
    <>
      <Link
        href="/login"
        className="rounded-md px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {t('site.signIn')}
      </Link>
      <Link
        href="/login?tab=signup"
        className="rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t('site.createAccount')}
      </Link>
    </>
  )
}

/* -------------------------------------------------------------- sections -- */

function Hero() {
  const t = useT()
  return (
    <section className="mx-auto max-w-5xl px-5 pb-16 pt-20 sm:px-6 sm:pt-28">
      <p className="text-xs font-medium uppercase tracking-wider text-primary-strong">
        {t('landing.eyebrow')}
      </p>
      <h1 className="mt-4 max-w-3xl text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
        {t('landing.headline')}
      </h1>
      <p className="mt-5 max-w-2xl text-balance text-lg text-muted-foreground">
        {t('landing.lede')}
      </p>
      <div className="mt-9 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/login?tab=signup"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {t('site.createAccount')}
          <ArrowRight size={16} />
        </Link>
        <Link
          href="/login"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-5 py-3 text-sm font-medium transition-colors hover:bg-accent"
        >
          {t('site.signIn')}
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
  const t = useT()
  const items = [
    { icon: BookOpen, n: '1' },
    { icon: ScanSearch, n: '2' },
    { icon: FileCheck2, n: '3' },
    { icon: Scale, n: '4' },
    { icon: Landmark, n: '5' },
    { icon: Terminal, n: '6' },
  ] as const
  return (
    <section className="border-t border-border bg-muted/40">
      <div className="mx-auto max-w-5xl px-5 py-16 sm:px-6 sm:py-20">
        <h2 className="max-w-2xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('landing.whatItDoes')}
        </h2>
        <div className="mt-10 grid gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <div key={it.n}>
              <span className="inline-flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary-strong">
                <it.icon size={18} />
              </span>
              <h3 className="mt-3.5 text-[15px] font-semibold">
                {t(`landing.f${it.n}.title`)}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {t(`landing.f${it.n}.copy`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function ForAgents() {
  const t = useT()
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-5xl px-5 py-16 sm:px-6 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-primary-strong">
              {t('landing.agentEyebrow')}
            </p>
            <h2 className="mt-4 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              {t('landing.agentHeadline')}
            </h2>
            {/* The three command names are interpolated into the sentence rather
                than wrapped in `<span className="font-mono">` around it. French
                reorders both clauses; splitting the paragraph into fragments in
                JSX would fix English word order into the French. The monospace
                treatment of `bk`, `bk guide` and `bk meta` is what that costs,
                and it is the same trade the token page makes. */}
            <p className="mt-4 text-muted-foreground">
              {t('landing.agentP1', { bk: 'bk', guide: 'bk guide' })}
            </p>
            <p className="mt-4 text-muted-foreground">{t('landing.agentP2', { meta: 'bk meta' })}</p>
            <p className="mt-4 text-muted-foreground">{t('landing.agentP3')}</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="text-[15px] font-semibold">{t('landing.lawTitle')}</h3>
            <dl className="mt-4 space-y-3.5 text-sm">
              {(['1', '2', '3'] as const).map((n) => (
                <div key={n}>
                  <dt className="font-medium text-foreground">
                    {t(`landing.law${n}.term`)}
                  </dt>
                  <dd className="mt-0.5 text-muted-foreground">
                    {t(`landing.law${n}.def`)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  )
}

function FinalCTA() {
  const t = useT()
  return (
    <section className="border-t border-border bg-muted/40">
      <div className="mx-auto max-w-5xl px-5 py-16 text-center sm:px-6 sm:py-20">
        <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('landing.ctaHeadline')}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">{t('landing.ctaBody')}</p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/login?tab=signup"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {t('site.createAccount')}
            <ArrowRight size={16} />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-lg border border-border px-5 py-3 text-sm font-medium transition-colors hover:bg-accent"
          >
            {t('site.signIn')}
          </Link>
        </div>
      </div>
    </section>
  )
}

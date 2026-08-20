// The frame around every SIGNED-OUT page in b/books: the marketing page and the
// front door.
//
// Extracted rather than copied, and that is the whole reason it is its own file.
// Two copies of a header drift, and this repo has spent a week on exactly that
// failure in four other places: the brand mark had three treatments in one app,
// the invite link had two spellings, a login footer described a mechanism that
// had been deleted. `apps/sales/components/site-chrome.tsx` is the file this
// pattern comes from and its header records why.
//
// ── THE HEADER'S RIGHT-HAND SIDE IS THE CALLER'S ───────────────────────────
// `nav` is rendered right-aligned. The marketing page offers "Sign in" and
// "Create an account"; the login page offers neither, because both of them ARE
// the page you are already on. What the auth page keeps is the BRAND, which is
// the way back to `/`, and that is the point of giving it a header at all.

'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useT } from '@/lib/i18n'

export function SiteHeader({ children }: { children?: React.ReactNode }) {
  const t = useT()
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-11 max-w-5xl items-center gap-2.5 px-5 sm:px-6">
        <Link href="/" aria-label={t('site.home')} className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="b/" width={20} height={20} className="rounded-[14%]" />
          <span className="text-[15px] font-semibold tracking-tight">books</span>
        </Link>
        {children ? <nav className="ml-auto flex items-center gap-2">{children}</nav> : null}
      </div>
    </header>
  )
}

export function SiteFooter() {
  const t = useT()
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-5 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:px-6">
        <span>{t('site.footer')}</span>
        <a href="mailto:contact@blackcode.ch" className="hover:text-foreground sm:ml-auto">
          contact@blackcode.ch
        </a>
      </div>
    </footer>
  )
}

/**
 * Header, content, footer — the shape every signed-out page has.
 *
 * `main` grows, so the footer sits at the bottom of a short page (the login
 * card) instead of floating under it, and the auth card can centre itself inside
 * the remaining space without knowing the header's height.
 */
export function SiteFrame({ nav, children }: { nav?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader>{nav}</SiteHeader>
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  )
}

// The frame around every SIGNED-OUT page in b/issues: the landing page, the
// front door, and the agent page.
//
// Same shape as apps/sales, apps/books and apps/billing's `site-chrome.tsx`
// (2026-09-28). Until then this app had its own `components/marketing/*` — a
// taller header, a "Get started" button, a three-link legal footer — and was
// the one app of four whose signed-out pages looked like a different product.
// Keep the four in step: a change here is a change there.
//
// `nav` is the caller's: the landing page offers "Sign in" / "Create an
// account"; the login page offers neither, since both are the page you are
// already on. The brand (the way back to `/`) and the theme switch are on every
// signed-out page.

import Image from 'next/image'
import Link from 'next/link'
import { ThemeToggle } from '@blackcode/platform-ui/ui/theme-toggle'

export function SiteHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-5xl items-center gap-2.5 px-5 sm:px-6">
        <Link href="/" aria-label="b/issues home" className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="b/" width={22} height={22} className="rounded-[14%]" />
          <span className="text-[15px] font-semibold tracking-tight">issues</span>
        </Link>
        <nav className="ml-auto flex items-center gap-2">
          {children}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-5 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:px-6">
        <span>b/issues — a blackcode product.</span>
        <span className="flex gap-4 sm:ml-auto">
          <Link href="/agent-updator" className="hover:text-foreground">
            For agents
          </Link>
          <a href="mailto:contact@blackcode.ch" className="hover:text-foreground">
            contact@blackcode.ch
          </a>
        </span>
      </div>
    </footer>
  )
}

/** Header, content, footer — the shape every signed-out page has. */
export function SiteFrame({ nav, children }: { nav?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader>{nav}</SiteHeader>
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  )
}

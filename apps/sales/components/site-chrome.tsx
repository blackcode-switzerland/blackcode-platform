// The frame around every SIGNED-OUT page in b/sales: the landing page and the
// front door.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS AT ALL
// ---------------------------------------------------------------------------
// Until 2026-08-11 the header and footer below lived inside
// `components/landing-page.tsx`, and `/login` had neither: it was a bare card
// centred in an otherwise empty viewport. Clicking "Sign in" on a page with
// chrome landed you on a page without any, which reads as having left the site
// rather than having moved inside it — and there was no way back to `/` short
// of editing the URL.
//
// It is EXTRACTED rather than copied. Two copies of a header drift, and this
// repo has spent a week on exactly that failure in four other places: the brand
// mark had three treatments in one app, the invite link had two spellings, the
// login footer described a mechanism that had been deleted. A second copy would
// have been a fifth.
//
// ---------------------------------------------------------------------------
// THE HEADER'S RIGHT-HAND SIDE IS THE CALLER'S
// ---------------------------------------------------------------------------
// `children` is the nav. The landing page offers "Sign in" and "Create an
// account"; the login page offers neither, because both of them are the page
// you are already on — a header that invites you to do the thing in front of
// you is noise, and "Create an account" beside a form with a Create-account tab
// is two controls for one action. What the auth pages keep is the BRAND, which
// is the way back to `/`, and that is the whole point of giving them a header.
//
// ---------------------------------------------------------------------------
// COLOUR
// ---------------------------------------------------------------------------
// Not one hex, same as the page it came from — Tailwind tokens from the shared
// theme, which is where sales' warm neutrals and emerald primary already live
// (D-4). `lib/palette.test.ts` scans this directory.

import Image from 'next/image'
import Link from 'next/link'

/**
 * The signed-out header. `children` is rendered right-aligned as the nav; pass
 * nothing for a brand-only bar.
 *
 * h-12 is the sales density (D-4) — the same header height `sales-shell.tsx`
 * uses, so arriving in the product is not a jolt.
 */
export function SiteHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-5xl items-center gap-2.5 px-5 sm:px-6">
        {/* The brand is a LINK here and was not one before. On the landing page
            it pointed at the page you were reading, so nothing was lost; on the
            auth pages it is the only way back out. */}
        <Link href="/" aria-label="b/sales home" className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="b/" width={22} height={22} className="rounded-md" />
          <span className="text-[15px] font-semibold tracking-tight">sales</span>
        </Link>
        {children ? <nav className="ml-auto flex items-center gap-2">{children}</nav> : null}
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-5 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:px-6">
        <span>b/sales — a blackcode product.</span>
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
 * card) instead of floating under it, and the auth card can centre itself
 * inside the remaining space without knowing the header's height.
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

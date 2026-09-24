// The frame around every SIGNED-OUT page in this app: the landing page, the
// login form and its reset panel.
//
// Extracted rather than copied into each page — modelled on apps/sales'
// `components/site-chrome.tsx`, which exists precisely because two copies of a
// header drift (that file's own header lists four places it already had).
//
// `children` (the header nav) is the caller's: the landing page offers "Sign
// in" / "Create an account"; the login page offers neither, since both are the
// page you are already on. What every signed-out page keeps is the brand — the
// way back to `/`.
//
import Link from 'next/link'
import { BrandMark, wordmark } from '@/components/brand'
import { APP_NAME, CONTACT_EMAIL } from '@/lib/app'

export { BrandMark }

export function SiteHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-5xl items-center gap-2.5 px-5 sm:px-6">
        <Link href="/" aria-label={`${APP_NAME} home`} className="flex items-center gap-2.5">
          <BrandMark />
          <span className="text-[15px] font-semibold tracking-tight">{wordmark(APP_NAME)}</span>
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
        <span>{APP_NAME} — Swiss QR-bill invoicing.</span>
        <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-foreground sm:ml-auto">
          {CONTACT_EMAIL}
        </a>
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

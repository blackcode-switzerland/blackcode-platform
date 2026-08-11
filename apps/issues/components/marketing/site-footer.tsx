import Link from 'next/link'
import { Brand } from './brand'

const YEAR = new Date().getFullYear()

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-background">
      <div className="mx-auto max-w-7xl px-6 py-4">
        {/* Top row: brand + tagline (left), legal links (right) */}
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex max-w-md flex-col gap-2">
            <Brand size="sm" />
            <p className="text-sm text-muted-foreground max-w-xs">
              Issue tracking for humans and the agents working alongside them.
     
            </p>
          </div>
          <nav className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link
              href="/agent-updator"
              className="transition-colors hover:text-foreground"
            >
              For agents
            </Link>
            <Link
              href="/privacy"
              className="transition-colors hover:text-foreground"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="transition-colors hover:text-foreground"
            >
              Terms
            </Link>
          </nav>
        </div>

        {/* Bottom row: full copyright, centred */}
        <div className="mt-6 border-t border-border/60 pt-6 text-center text-xs text-muted-foreground">
          © {YEAR} b/issues. All rights reserved.
        </div>
      </div>
    </footer>
  )
}

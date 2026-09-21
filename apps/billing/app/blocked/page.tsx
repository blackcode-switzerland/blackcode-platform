import Link from 'next/link'
import { ShieldX } from 'lucide-react'
import { APP_NAME } from '@/lib/app'

// Where `lib/auth.ts`'s Google `signIn` callback sends an email the whitelist
// refuses. The callback returns a PATH, and a path that 404s turns "you are not
// allowed in" into "the app is broken" — the same reason apps/sales has one.
export default function BlockedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldX size={20} />
        </div>
        <h1 className="text-base font-semibold text-foreground">Access not available</h1>
        <p className="text-sm text-muted-foreground">
          That Google account is not allowed on {APP_NAME} yet. Access is granted by invitation — ask
          the person who runs your workspace, then try again.
        </p>
        <Link href="/login" className="inline-block text-sm font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    </main>
  )
}

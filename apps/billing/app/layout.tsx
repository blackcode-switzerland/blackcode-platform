// The root layout — and the ONE import in it that a copied app must not lose.
//
// `./globals.css` is what makes Tailwind run for this app at all, and it is
// where the `@source` line for the shared UI package lives (D-30). An app whose
// root layout does not reach a stylesheet has no Tailwind build, so
// `packages/platform-testing/test/ui-package-styling.test.ts` cannot see what it
// builds — and that check skips loudly rather than passing, because "no CSS
// found" and "CSS is correct" must not look the same.
import './globals.css'
import { APP_NAME } from '@/lib/app'

// READ FROM `APP_NAME`, NEVER A LITERAL.
//
// The scaffold has `title: 'Scaffold app'` here, and a copied literal is the
// first thing a rebranded deployment shows wrong: the browser tab is visible
// before anything else on the page renders. `APP_NAME` is environment-driven
// (lib/app.ts) precisely so the standalone copy in
// docs/billing-app-plan/standalone-deployment.md needs no edit here.
export const metadata = { title: APP_NAME }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

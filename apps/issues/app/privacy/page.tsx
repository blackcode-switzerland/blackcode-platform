import type { Metadata } from 'next'
import { MarketingLayout } from '@/components/marketing/layout'

export const metadata: Metadata = {
  title: 'Privacy · b/issues',
  description: 'How b/issues handles your data.',
}

export default function PrivacyPage() {
  return (
    <MarketingLayout>
      <article className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <header className="mb-10">
          <div className="text-xs font-medium uppercase tracking-wider text-primary">
            Privacy
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated: {new Date().toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </header>

        <div className="prose space-y-6 text-sm leading-relaxed text-muted-foreground">
          <p>
            This page is a placeholder until a full privacy policy is published. It
            outlines the broad strokes of how b/issues handles your
            information.
          </p>

          <Section title="What we collect">
            <p>
              When you create an account, we store the email address you provide and a
              bcrypt-hashed copy of your password (or a Google OAuth identifier, if you
              signed in with Google). We may also store the display name and avatar
              your identity provider supplies. Beyond that, we keep the projects,
              issues, comments, attachments, and activity you create inside the
              product.
            </p>
          </Section>

          <Section title="How we use it">
            <p>
              Your data powers the product features you use. We do not sell your data
              and do not use it for advertising. Operational logs may be retained for a
              limited period to debug issues and prevent abuse.
            </p>
          </Section>

          <Section title="API tokens">
            <p>
              When you mint an API token, we store only its SHA-256 hash and a short
              prefix used to identify the token in your settings list. The plaintext
              token is shown to you exactly once at creation and never written to disk.
              Revoking a token removes its row from our database immediately.
            </p>
          </Section>

          <Section title="File uploads">
            <p>
              Files you attach to issues are stored either on Vercel Blob (in
              production) or on the server&rsquo;s local disk (in development). We do
              not scan attachment contents.
            </p>
          </Section>

          <Section title="Your choices">
            <p>
              You can delete your account, revoke tokens, and remove uploaded files at
              any time. Deletions cascade to the data they own. For self-hosted
              deployments, you control the database and storage directly.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              For privacy questions, reach out via the channel published in your
              workspace settings. This document will be replaced with a formal policy
              before any public launch.
            </p>
          </Section>
        </div>
      </article>
    </MarketingLayout>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  )
}

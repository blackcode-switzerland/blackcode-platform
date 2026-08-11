import type { Metadata } from 'next'
import { MarketingLayout } from '@/components/marketing/layout'

export const metadata: Metadata = {
  title: 'Terms · b/issues',
  description: 'Terms of service for using b/issues.',
}

export default function TermsPage() {
  return (
    <MarketingLayout>
      <article className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <header className="mb-10">
          <div className="text-xs font-medium uppercase tracking-wider text-primary">
            Terms
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Terms of Service
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
            This page is a placeholder until a formal terms of service is published. It
            outlines the broad strokes of acceptable use.
          </p>

          <Section title="Your account">
            <p>
              You are responsible for the security of your credentials and for any
              activity that happens under your account or API tokens. If you believe a
              token has been compromised, revoke it from your settings immediately and
              mint a new one.
            </p>
          </Section>

          <Section title="Acceptable use">
            <p>
              Do not use b/issues to break laws, harass others, distribute malware, or
              host illegal content. Don&rsquo;t attempt to circumvent rate limits or
              auth controls. Don&rsquo;t use the product to facilitate the same against
              other services.
            </p>
          </Section>

          <Section title="Self-hosting">
            <p>
              When you self-host, you control the data and operational stance of your
              installation. These terms apply to any hosted version we operate; for
              self-hosted deployments, the open-source license in the repository
              governs.
            </p>
          </Section>

          <Section title="Service status">
            <p>
              b/issues is in working-alpha state. Features may change, ship, or roll
              back. Status pills on the landing page reflect the current state of each
              feature.
            </p>
          </Section>

          <Section title="Termination">
            <p>
              You can stop using the service at any time and delete your account
              through settings. We may suspend accounts that violate these terms.
            </p>
          </Section>

          <Section title="Disclaimers">
            <p>
              The service is provided &ldquo;as is&rdquo; without warranties. Use at
              your own risk; back up your data. Liability is limited to what local law
              allows when a formal policy supersedes this placeholder.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              For questions about these terms, reach out via the channel published in
              your workspace settings.
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

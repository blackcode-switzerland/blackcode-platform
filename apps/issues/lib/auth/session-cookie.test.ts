// The shared session cookie (D-16, Phase 1h).
//
// ---------------------------------------------------------------------------
// WHAT LOCAL VERIFICATION CAN AND CANNOT REACH — READ THIS FIRST
// ---------------------------------------------------------------------------
// These tests check what this repo DECIDES: the name, the flags, the domain that
// gets attached, and the refusal when the domain could not work. They cannot
// check what a BROWSER does with the result, and that is where the risk is.
//
// Specifically, nothing here can observe:
//
//   - that a browser on `issues.blackcode.ch` accepts `Domain=.blackcode.ch`
//     and replays the cookie to `sales.blackcode.ch`. That needs two real
//     subdomains over HTTPS, which needs production DNS.
//   - that the OLD `__Secure-next-auth.session-token`, still sitting in every
//     browser, is genuinely inert. It is inert because no code reads that name —
//     which the grep in this file's last test checks — but "no code reads it" is
//     a claim about this repo, not about a browser.
//   - that a real sign-in round-trips. Locally `NEXTAUTH_URL` is http://, so the
//     cookie is unprefixed and host-only: the code path exercised is the one
//     where the change does nothing.
//
// **So the honest answer to "what would this still pass on if the domain were
// silently dropped?" is: everything, locally.** A `secure: false`, no-domain
// cookie is what localhost is supposed to produce, and it is indistinguishable
// from the change not working. That is why the domain is validated at
// construction and why the deploy is scheduled as its own release with a
// rollback — the check that matters is a human signing in on two subdomains.

import { describe, expect, it } from 'vitest'
import {
  SessionCookieDomainError,
  domainCoversHost,
  sessionCookieConfig,
  sessionCookieName,
} from '@blackcode/platform-auth'

const PROD = 'https://issues.blackcode.ch'

describe('the cookie name', () => {
  // The rename IS the feature. A cookie's identity in the browser jar is
  // (name, domain, path), so re-issuing `next-auth.session-token` with a domain
  // would create a SECOND cookie beside the existing host-only one rather than
  // replacing it — both sent, order unspecified, first one read.
  it('is not the name NextAuth would have used', () => {
    const name = sessionCookieConfig({ nextAuthUrl: PROD }).sessionToken.name
    expect(name).not.toContain('next-auth')
    expect(name).toBe('__Secure-blackcode.session-token')
  })

  // Matches NextAuth's own rule, so the cookies this config does NOT override —
  // csrf, callbackUrl, pkce, state — agree with it about `secure`.
  it('carries __Secure- only over https', () => {
    expect(sessionCookieConfig({ nextAuthUrl: PROD }).sessionToken.name).toBe(
      sessionCookieName(true)
    )
    expect(
      sessionCookieConfig({ nextAuthUrl: 'http://localhost:3000' }).sessionToken.name
    ).toBe(`${sessionCookieName(false)}.3000`)
    expect(sessionCookieName(false)).toBe('blackcode.session-token')
  })

  // LOCAL DEV: cookies are not scoped by port, so on localhost the two apps
  // share one jar. Without a per-port name, `apps/sales` reads the session
  // `apps/issues` minted — valid (same secret), so its first-sign-in bootstrap
  // never runs and it shows "No workspace yet" on a healthy machine.
  describe('on localhost, where the apps share a cookie jar', () => {
    it('gives each port its own session, csrf and callback cookies', () => {
      const a = sessionCookieConfig({ nextAuthUrl: 'http://localhost:3000' })
      const b = sessionCookieConfig({ nextAuthUrl: 'http://localhost:3100' })
      expect(a.sessionToken.name).not.toBe(b.sessionToken.name)
      expect(a.csrfToken?.name).toBe('next-auth.csrf-token.3000')
      expect(b.csrfToken?.name).toBe('next-auth.csrf-token.3100')
      expect(a.callbackUrl?.name).not.toBe(b.callbackUrl?.name)
    })

    // The POSITIVE half: production must be UNTOUCHED — one cookie across every
    // deployment is D-16, and the csrf cookie must keep NextAuth's `__Host-`.
    it('leaves a deployed host alone', () => {
      const prod = sessionCookieConfig({ nextAuthUrl: PROD })
      expect(prod.sessionToken.name).toBe('__Secure-blackcode.session-token')
      expect(prod.csrfToken).toBeUndefined()
      expect(prod.callbackUrl).toBeUndefined()
      expect(sessionCookieConfig({ nextAuthUrl: 'https://sales.blackcode.ch' }).sessionToken.name).toBe(
        prod.sessionToken.name
      )
    })
  })

  // `__Host-` forbids a Domain attribute, so a session cookie carrying that
  // prefix could never be shared. NextAuth puts `__Host-` on the CSRF cookie,
  // not this one — and this config must never acquire it.
  it('never carries __Host-', () => {
    for (const url of [PROD, 'http://localhost:3000']) {
      expect(sessionCookieConfig({ nextAuthUrl: url }).sessionToken.name).not.toContain('__Host-')
    }
  })
})

describe('the domain', () => {
  // The default that keeps localhost and every *.vercel.app preview working. A
  // hardcoded `.blackcode.ch` would be rejected by the browser in both, and the
  // symptom is a sign-in that bounces back to /login with nothing in the logs.
  it('is absent unless configured', () => {
    const opts = sessionCookieConfig({ nextAuthUrl: PROD }).sessionToken.options
    expect(opts).not.toHaveProperty('domain')
  })

  it('is attached when configured, with or without the leading dot', () => {
    for (const d of ['.blackcode.ch', 'blackcode.ch']) {
      expect(
        sessionCookieConfig({ nextAuthUrl: PROD, cookieDomain: d }).sessionToken.options.domain
      ).toBe(d)
    }
  })

  // THE ONE WORTH CRASHING ON. A domain the browser rejects produces no error
  // anywhere: the Set-Cookie is dropped, the session never establishes, and
  // every user of every app is locked out with a green deploy.
  it('refuses a domain this host could not set', () => {
    expect(() =>
      sessionCookieConfig({ nextAuthUrl: PROD, cookieDomain: '.example.com' })
    ).toThrow(SessionCookieDomainError)

    // The realistic typo: a preview deployment that inherited the production
    // env var. `issues-git-x.vercel.app` is not under `.blackcode.ch`.
    expect(() =>
      sessionCookieConfig({
        nextAuthUrl: 'https://issues-git-abc.vercel.app',
        cookieDomain: '.blackcode.ch',
      })
    ).toThrow(SessionCookieDomainError)
  })

  // A build with no NEXTAUTH_URL must not fail: there is nothing to validate
  // against, and the runtime that does have one will validate then.
  it('does not throw when there is nothing to validate against', () => {
    expect(() => sessionCookieConfig({ cookieDomain: '.blackcode.ch' })).not.toThrow()
  })
})

describe('domainCoversHost', () => {
  it.each([
    ['.blackcode.ch', 'issues.blackcode.ch', true],
    ['blackcode.ch', 'issues.blackcode.ch', true],
    ['.blackcode.ch', 'blackcode.ch', true],
    ['.blackcode.ch', 'sales.blackcode.ch', true],
    ['.blackcode.ch', 'a.b.blackcode.ch', true],
    // The suffix trap: `notblackcode.ch` ENDS WITH `blackcode.ch`, and a naive
    // `endsWith` would accept it. The separating dot is load-bearing — the same
    // shape as the blob-host check in `lib/storage`, which had this exact bug.
    ['.blackcode.ch', 'notblackcode.ch', false],
    ['.blackcode.ch', 'blackcode.ch.attacker.test', false],
    ['.blackcode.ch', 'issues-git-abc.vercel.app', false],
    ['.blackcode.ch', 'localhost', false],
    ['', 'issues.blackcode.ch', false],
    ['.blackcode.ch', '', false],
  ])('%s covers %s → %s', (domain, host, want) => {
    expect(domainCoversHost(domain, host)).toBe(want)
  })
})

describe('the old cookie is inert', () => {
  // Not a claim about browsers — the old cookie sits in them until it expires,
  // and nothing can delete it from here. It is a claim about this repo: no code
  // reads the name NextAuth used to write, so the leftover cookie cannot be
  // picked up in preference to the new one.
  //
  // Asserted rather than assumed because the failure it guards is the one that
  // has no symptom: a stale reader would silently win over the new cookie on
  // the one host that has both.
  it('no source file names the old cookie', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const roots = [join(__dirname, '..', '..'), join(__dirname, '..', '..', '..', '..', 'packages')]

    // The two files whose JOB is to explain the rename name the old cookie in
    // prose. Listed one by one rather than pattern-matched, so a third file
    // acquiring the string is a decision somebody makes here.
    const explains = ['session-cookie.ts', 'session-cookie.test.ts']

    const hits: string[] = []
    let scanned = 0
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (['node_modules', '.next', '.turbo', '.git'].includes(name)) continue
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.tsx?$/.test(name) && !explains.some((e) => p.endsWith(e))) {
          scanned++
          if (readFileSync(p, 'utf8').includes('next-auth.session-token')) hits.push(p)
        }
      }
    }
    for (const r of roots) walk(r)

    // Assert the input: a scan that read nothing would report a confident green.
    expect(scanned).toBeGreaterThan(100)
    expect(hits).toEqual([])
  })
})

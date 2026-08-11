// The two landing pads in next.config.js stay landed.
//
// ---------------------------------------------------------------------------
// WHAT THIS CHECKS, AND WHAT IT DOES NOT
// ---------------------------------------------------------------------------
// This asserts the CONFIG, not the server. It cannot tell you that Next honours
// the table, that the destinations resolve, or that the status code on the wire
// is the one written here — those were checked by driving a running dev server
// (`curl` → 307 → 200 at both destinations, 2026-08-11), which is the evidence
// that the fix works. What this file protects is the much duller and much more
// likely regression: someone tidying next.config.js and removing two entries
// whose reason is not obvious from the diff.
//
// So it asserts the reasons, not just the strings: that `/changelog` goes to the
// API and NOT to a page (the page was deliberately removed on 2026-08-03 and
// must not come back), and that neither is permanent, because both point at
// spellings that may yet change and a 308 is cached past our ability to fix it.
//
// Todo/issues-app-feedback.md item 4.

import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const config = require(path.join(__dirname, '../../next.config.js'))

describe('dead-link redirects', () => {
  it('next.config.js declares a redirects() table', async () => {
    // Assert the input. Without this, every expectation below would pass
    // vacuously against `undefined` if the hook were renamed or dropped.
    expect(typeof config.redirects).toBe('function')
    const rules = await config.redirects()
    expect(Array.isArray(rules)).toBe(true)
    expect(rules.length).toBeGreaterThan(0)
  })

  it('sends the correctly-spelled /agent-updater at the misspelled real page', async () => {
    const rules = await config.redirects()
    const rule = rules.find((r: { source: string }) => r.source === '/agent-updater')
    expect(rule, 'no rule for /agent-updater').toBeDefined()
    expect(rule.destination).toBe('/agent-updator')
    expect(rule.permanent).toBe(false)
  })

  it('sends /changelog at the API surface, never at a page', async () => {
    const rules = await config.redirects()
    const rule = rules.find((r: { source: string }) => r.source === '/changelog')
    expect(rule, 'no rule for /changelog').toBeDefined()
    // The specific thing that must never be reintroduced is an HTML page here.
    expect(rule.destination).toBe('/api/changelog')
    expect(rule.destination.startsWith('/api/')).toBe(true)
    expect(rule.permanent).toBe(false)
  })
})

// The advertised CLI versions, read from npm dist-tags.
//
// The failure that matters most is the FLOOR moving when it should not: a bad
// or failed npm answer that lowered `min` would unblock binaries the server no
// longer supports, and one that raised it past `latest` would lock everyone
// out. So most cases here are about what a failure must NOT change.

import { describe, it, expect } from 'vitest'
import { createCliVersionSource } from '../src/cli-version'

function fakeNpm(initial: Record<string, unknown> | Error) {
  const state = { answer: initial, calls: 0 }
  const fetch = async () => {
    state.calls++
    if (state.answer instanceof Error) throw state.answer
    return new Response(JSON.stringify(state.answer), { status: 200 })
  }
  return { state, fetch }
}

/** Let a background refresh finish. */
const settle = () => new Promise((r) => setTimeout(r, 0))

function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t }
  return c
}

describe('getCliVersions', () => {
  it('advertises the npm dist-tags', async () => {
    const npm = fakeNpm({ latest: '6.2.0', min: '6.0.0' })
    const get = createCliVersionSource({ fetch: npm.fetch, env: {} })
    expect(await get()).toEqual({ latest: '6.2.0', min: '6.0.0', source: 'npm' })
  })

  it('a publish is visible after the cache expires, with no deploy', async () => {
    const npm = fakeNpm({ latest: '6.2.0', min: '6.0.0' })
    const c = clock()
    const get = createCliVersionSource({ fetch: npm.fetch, now: c.now, env: {} })
    await get()
    npm.state.answer = { latest: '6.3.0', min: '6.0.0' }

    c.t += 60_000
    expect((await get()).latest).toBe('6.2.0') // still cached
    expect(npm.state.calls).toBe(1)

    // Expired: this request is served the old answer while npm is asked...
    c.t += 5 * 60_000
    expect((await get()).latest).toBe('6.2.0')
    expect(npm.state.calls).toBe(2)
    // ...and the next one sees the new one.
    await settle()
    expect((await get()).latest).toBe('6.3.0')
  })

  it('keeps the last good answer when npm fails, and retries later', async () => {
    const npm = fakeNpm({ latest: '6.2.0', min: '6.1.0' })
    const c = clock()
    const get = createCliVersionSource({ fetch: npm.fetch, now: c.now, env: {} })
    await get()

    npm.state.answer = new Error('registry down')
    c.t += 10 * 60_000
    await get()
    await settle()
    expect(await get()).toEqual({ latest: '6.2.0', min: '6.1.0', source: 'npm' })
    expect(npm.state.calls).toBe(2)

    npm.state.answer = { latest: '6.4.0', min: '6.1.0' }
    c.t += 61_000
    await get()
    await settle()
    expect((await get()).latest).toBe('6.4.0')
  })

  it('ignores a malformed answer rather than advertising it', async () => {
    const npm = fakeNpm({ latest: '6.2.0', min: '6.1.0' })
    const c = clock()
    const get = createCliVersionSource({ fetch: npm.fetch, now: c.now, env: {} })
    await get()
    npm.state.answer = { latest: 'banana', min: '0.0.1' }
    c.t += 10 * 60_000
    await get()
    await settle()
    expect(await get()).toEqual({ latest: '6.2.0', min: '6.1.0', source: 'npm' })
  })

  it('never advertises a floor above latest', async () => {
    const npm = fakeNpm({ latest: '6.2.0', min: '7.0.0' })
    const get = createCliVersionSource({ fetch: npm.fetch, env: {} })
    expect((await get()).min).toBe('6.2.0')
  })

  it('compares versions numerically, not as strings', async () => {
    const npm = fakeNpm({ latest: '6.10.0', min: '6.9.0' })
    const get = createCliVersionSource({ fetch: npm.fetch, env: {} })
    expect((await get()).min).toBe('6.9.0')
  })

  it('falls back when npm has never answered, and when there is no min tag', async () => {
    const down = createCliVersionSource({ fetch: fakeNpm(new Error('down')).fetch, env: {} })
    const r = await down()
    expect(r.source).toBe('fallback')
    expect(r.latest).toMatch(/^\d+\.\d+\.\d+$/)

    const noMin = createCliVersionSource({ fetch: fakeNpm({ latest: '99.0.0' }).fetch, env: {} })
    const r2 = await noMin()
    expect(r2.latest).toBe('99.0.0')
    expect(r2.min).toBe(r.min) // the fallback floor, not latest
  })

  it('an env pin wins and skips the network', async () => {
    const npm = fakeNpm({ latest: '6.2.0', min: '6.0.0' })
    const get = createCliVersionSource({
      fetch: npm.fetch,
      env: { BK_CLI_LATEST: '5.5.0', BK_CLI_MIN: '5.1.0' },
    })
    expect(await get()).toEqual({ latest: '5.5.0', min: '5.1.0', source: 'env' })
    expect(npm.state.calls).toBe(0)
  })

  it('only the first request waits for npm; an expired answer does not block', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let calls = 0
    const fetch = async () => {
      calls++
      if (calls > 1) await gate // the refresh hangs
      return new Response(JSON.stringify({ latest: '6.2.0', min: '6.0.0' }), { status: 200 })
    }
    const c = clock()
    const get = createCliVersionSource({ fetch, now: c.now, env: {} })
    await get()
    c.t += 10 * 60_000
    // Resolves even though the refresh has not.
    expect((await get()).latest).toBe('6.2.0')
    expect(calls).toBe(2)
    release()
  })

  it('concurrent requests share one lookup', async () => {
    const npm = fakeNpm({ latest: '6.2.0', min: '6.0.0' })
    const get = createCliVersionSource({ fetch: npm.fetch, env: {} })
    await Promise.all([get(), get(), get()])
    expect(npm.state.calls).toBe(1)
  })
})

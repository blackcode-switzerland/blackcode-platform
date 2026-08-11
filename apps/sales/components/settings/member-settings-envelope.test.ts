// The members page went blank in production on 2026-08-11, and no route test
// could have caught it: BOTH routes were correct.
//
// `workspaceMembersRoute` answers with `jsonList(...)` — `{ data, next_cursor }`
// — and the component asked for `apiGet<Member[]>`. TypeScript believed the
// annotation, so `members.data` was the ENVELOPE. It is truthy, so the
// `members.data && (...)` guard passed, and `.map` threw
// `x.data.map is not a function`. The invitations query had the same defect via
// an `as unknown as` cast, and failed the other way: `.length` on the envelope
// is `undefined`, so `undefined > 0` was false and the list silently rendered
// nothing.
//
// WHY THIS TEST IS TEXTUAL, which is normally a smell. The bug lives in the
// gap between two files' beliefs about a wire format. A unit test of either
// side passes — the route really does return an envelope, and the component
// really does map over what it was told is an array. There is no runtime seam
// to assert against without standing up a server and a browser, and the thing
// that went wrong is a claim in a type annotation. So: assert the SHAPE OF THE
// CALL.
//
// CLAUDE.md finding #11 is the risk here — the granularity of a text scan is
// part of what it checks. That is why the premise assertions below exist and
// why the pattern anchors on `apiGet<{ data:` rather than on the word `data`,
// which appears in this file dozens of times.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = join(__dirname, 'member-settings.tsx')
const raw = readFileSync(SOURCE, 'utf8')

// STRIP COMMENTS BEFORE SCANNING. The first version of this file did not, and
// failed on its own prose: the comment explaining the `as unknown as` bug
// contains the string `as unknown as`. That is D-42 — a guard that matches text
// will match the text that explains it — and it is written down in this repo,
// which did not stop it happening here.
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Every `apiGet<…>(…)` call in the file, with its type argument. */
function apiGetCalls(): string[] {
  return [...src.matchAll(/apiGet<([^>]*(?:>[^>]*)?)>\(/g)].map((m) => m[1].trim())
}

describe('member-settings.tsx list queries', () => {
  it('PREMISE: the file makes at least two apiGet calls', () => {
    // Without this, every assertion below passes on a file that was renamed,
    // emptied, or had its calls refactored out of textual reach.
    expect(apiGetCalls().length).toBeGreaterThanOrEqual(2)
  })

  it('asks for the ENVELOPE, never a bare array', () => {
    for (const typeArg of apiGetCalls()) {
      // `{ data: Member[] }` is right. `Member[]` is the bug.
      expect(
        typeArg.startsWith('{'),
        `apiGet<${typeArg}> asks for a bare value, but these routes answer ` +
          `with jsonList's { data, next_cursor } envelope. Ask for ` +
          `{ data: ${typeArg} } and unwrap it.`
      ).toBe(true)
      expect(typeArg).toMatch(/^\{\s*data\s*:/)
    }
  })

  it('UNWRAPS the envelope rather than casting it', () => {
    // The original bug shipped as `(await apiGet<{ data: X[] }>(…)) as unknown
    // as X[]` — the right type argument with the wrong ending. Asking only for
    // the envelope type would have passed on it.
    // NOTE the `(?:[^()]|\([^()]*\))*` — the argument is `wsPath(ws, '/x')`, so
    // a naive `[^)]*\)` stops at the INNER close paren and reports `)).data`.
    for (const m of src.matchAll(/apiGet<\{[^}]*\}>\((?:[^()]|\([^()]*\))*\)/g)) {
      const after = src.slice(m.index! + m[0].length, m.index! + m[0].length + 40)
      // `^\)*\s*\.data` and not `startsWith('.data')`: the call sits inside
      // `(await …)`, so the very next character is that wrapper's `)`.
      expect(
        /^\)*\s*\.data\b/.test(after),
        `an apiGet call for an envelope is not followed by \`.data\` — found ` +
          `"${after.trim().slice(0, 30)}…". A cast renames the envelope; it ` +
          `does not open it.`
      ).toBe(true)
    }
  })

  it('never casts a response with `as unknown as`', () => {
    expect(
      src.includes('as unknown as'),
      '`as unknown as` on a fetch response silences the compiler about the ' +
        'exact mismatch this file shipped. Unwrap instead.'
    ).toBe(false)
  })
})

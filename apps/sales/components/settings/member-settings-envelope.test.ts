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
//
// ---------------------------------------------------------------------------
// 2026-08-11 — THE THIRD ASSERTION HAD OUTGROWN ITS PREMISE
// ---------------------------------------------------------------------------
// It read: every `apiGet<{…}>` call must be followed IMMEDIATELY by `.data`.
// That was right while every route this file called answered with `jsonList` —
// `{ data, next_cursor }`, where the envelope is pure packaging and keeping it
// can only be a mistake.
//
// `GET /api/workspaces/{ws}/invite-candidates` is not one of those. It answers
// `{ data, is_super_admin }`, and the flag is the SERVER's decision about who
// may see the platform-wide list — the one thing the component must not guess.
// Unwrapping that call at the call site would throw the answer away. So the old
// spelling of the rule now failed a correct line, which is the mirror image of
// finding #10: an assertion phrased for a narrower world, still pointing at it.
//
// The rule is therefore split by what the payload IS, not by where it came from:
//
//   * a payload with ONE field (`{ data: X[] }`) is nothing but an envelope —
//     open it at the call site, as before. This is the assertion that catches
//     the bug this file exists for, and it is unchanged for those calls.
//   * a payload with MORE than one field is carrying something besides the
//     list, and each extra field must actually be READ somewhere in this
//     component. Asking the server for a flag and never looking at it is the
//     same defect wearing different clothes — and it is the positive case
//     (finding #16): assert the thing that must be used, not only the thing
//     that must not happen.

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

  /** Top-level field names of an `apiGet` type argument like `{ a: X; b: Y }`. */
  function fieldsOf(typeArg: string): string[] {
    const body = typeArg.replace(/^\{/, '').replace(/\}$/, '')
    const names: string[] = []
    let depth = 0
    let field = ''
    for (const ch of body) {
      if ('<([{'.includes(ch)) depth++
      else if ('>)]}'.includes(ch)) depth--
      if ((ch === ';' || ch === ',') && depth === 0) {
        names.push(field)
        field = ''
      } else field += ch
    }
    names.push(field)
    return names
      .map((f) => f.split(':')[0].trim())
      .filter(Boolean)
  }

  it('UNWRAPS a pure envelope rather than casting it', () => {
    // The original bug shipped as `(await apiGet<{ data: X[] }>(…)) as unknown
    // as X[]` — the right type argument with the wrong ending. Asking only for
    // the envelope type would have passed on it.
    // NOTE the `(?:[^()]|\([^()]*\))*` — the argument is `wsPath(ws, '/x')`, so
    // a naive `[^)]*\)` stops at the INNER close paren and reports `)).data`.
    let checked = 0
    for (const m of src.matchAll(/apiGet<(\{[^}]*\})>\((?:[^()]|\([^()]*\))*\)/g)) {
      if (fieldsOf(m[1]).length !== 1) continue // carries more than the list
      checked++
      const after = src.slice(m.index! + m[0].length, m.index! + m[0].length + 40)
      // `^\)*\s*\.data` and not `startsWith('.data')`: the call sits inside
      // `(await …)`, so the very next character is that wrapper's `)`.
      expect(
        /^\)*\s*\.data\b/.test(after),
        `an apiGet call for a bare envelope is not followed by \`.data\` — found ` +
          `"${after.trim().slice(0, 30)}…". A cast renames the envelope; it ` +
          `does not open it.`
      ).toBe(true)
    }
    // Assert the input: this rule is the reason the file exists, and a regex
    // that stopped matching would otherwise report success by checking nothing.
    expect(checked, 'no bare-envelope apiGet call was found to check').toBeGreaterThanOrEqual(2)
  })

  it('READS every extra field it asks the server for', () => {
    // The positive half. A payload wider than `{ data }` was widened for a
    // reason; if the extra field is never read, either the component is
    // guessing what the server was asked to decide, or the widening is dead.
    for (const typeArg of apiGetCalls()) {
      const extras = fieldsOf(typeArg).filter((f) => f !== 'data')
      for (const field of extras) {
        // Count outside the type argument itself — the declaration is not a use.
        const uses = src.split(field).length - 1
        expect(
          uses,
          `\`${field}\` is asked for in apiGet<${typeArg}> and never read. ` +
            `Either use the server's answer or stop requesting it.`
        ).toBeGreaterThan(1)
      }
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

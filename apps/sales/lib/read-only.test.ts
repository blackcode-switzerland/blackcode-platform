// How a reviewer verifies that `read_only` renders no mutation affordance —
// as a fact about the tree, not about anybody's care.
//
// ===========================================================================
// WHAT AGENT6 LEFT, AND WHAT PHASE 9 HAD TO NOT BREAK
// ===========================================================================
// Before this phase the app exported exactly one request function, `apiGet`, and
// contained no mutation verb anywhere. "The web is read-only" was therefore a
// PROPERTY of the module graph — one anybody could confirm with grep — rather
// than an intention. Adding writes as `fetch` calls inside components would have
// turned it back into an intention, and nobody would have been able to check it
// again without reading every component.
//
// The arrangement that keeps it checkable:
//
//   lib/client.ts     the ONE `fetch(` in the app. `apiGet` + `apiSend`.
//                     Transport; consults nothing.
//   lib/mutations.ts  the ONE module that sends `apiSend` at an
//                     `/api/workspaces/…` path — i.e. at a sales RECORD. Every
//                     hook in it is built on `useRecordMutation`, the single
//                     `useMutation` in the file, which reads `useCanWrite()`.
//   components/**     render `useCanWrite()` and call those hooks. No fetch, no
//                     apiSend, no method strings.
//
// So the question "can a component write in read-only mode?" is answered by four
// assertions rather than by an audit. **What this does NOT claim**: that every
// button is correctly hidden. It claims that every record write goes through one
// gated function, so a button that was not hidden fails loudly instead of
// writing — which is what makes a missed affordance findable at all.
//
// ===========================================================================
// AND IT IS NOT A SECURITY CONTROL (D-7)
// ===========================================================================
// The gate is client-side, the user owns the client, and they can flip the
// preference themselves. Authorisation is workspace MEMBERSHIP and the workspace
// role, on the server (it was `platform.app_access` and the role until that
// table was dropped on 2026-08-10), and it refuses a write the UI allowed
// exactly as readily as one it did not. `lib/ui-mode.test.ts` is the file that keeps
// that true from the other direction.
//
// Watched fail 2026-08-07, five ways, each restored:
//   A. `fetch(` added to `components/prospects/prospect-forms.tsx` → RED
//   B. `apiSend('PATCH', '/api/workspaces/…/prospects/1')` in a component → RED
//   C. a second `useMutation(` added to `lib/mutations.ts` → RED
//   D. STEP 3, "what would this still pass on?": an ALLOWED module
//      (`token-settings.tsx`) pointed at a workspace path. Without the path rule
//      applying INSIDE the allowance too, "allowed to call apiSend" would have
//      quietly meant "allowed to write records". RED.
//   E. the `throw new ReadOnlyModeError()` deleted from `useRecordMutation` —
//      the case where every structural assertion above stays green because the
//      structure is intact and only the gate is gone. RED, on the input check.
//
// And the file failed on ITSELF before `codeOf` existed: three modules' headers
// contain the literal needles while explaining the rule. That is finding #4's
// shape, and it is why the scan drops comment lines.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

const rel = (p: string) => relative(APP_ROOT, p).split('\\').join('/')

/**
 * The source with comment-only lines removed.
 *
 * **Not tidiness — the first version of this file failed on itself.** Every
 * module here documents the rule it follows, in sentences containing the exact
 * needles: `lib/mutations.ts`'s header says "the ONLY `fetch(` in the app" and
 * "counts the `useMutation(` occurrences", and `cli-authorize-form.tsx` says it
 * POSTs "rather than calling `fetch`". A detector that fires on the
 * documentation of its own rule is CLAUDE.md's finding #4, and the outcome there
 * is that somebody weakens or deletes it (D-37).
 *
 * Dropping whole comment LINES rather than parsing comments is deliberate, and
 * it is the same trade `packages/platform-testing`'s export-list detector makes:
 * stripping comments properly needs a tokenizer that understands quotes and
 * template literals, whereas a line filter needs nothing and cannot misfire on a
 * `https://` inside a string. Calls in this app are always on code lines.
 */
function codeOf(src: string): string {
  return src
    .split('\n')
    .filter((line) => {
      const t = line.trimStart()
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
    })
    .join('\n')
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(p)
  }
  return out
}

const SOURCES = [
  ...walk(join(APP_ROOT, 'app')),
  ...walk(join(APP_ROOT, 'components')),
  ...walk(join(APP_ROOT, 'lib')),
]

/** The one module allowed to call `fetch`. */
const TRANSPORT = 'lib/client.ts'
/** The one module allowed to write a sales RECORD. */
const RECORD_WRITES = 'lib/mutations.ts'

/**
 * Modules other than `lib/mutations.ts` that may call `apiSend`, with reasons.
 *
 * Every one of them is an ACCOUNT operation, not a sales record — the platform's
 * `platform.users`, `platform.api_tokens`, the caller's own preferences. None is
 * behind `ui_mode` and none should be: a browser display preference that could
 * stop somebody changing their own name, revoking a leaked token, or switching
 * the preference back would have become a permission over the account, which is
 * the misreading D-7 exists to prevent.
 *
 * The `/api/workspaces/…` rule below applies to these files TOO, which is what
 * stops an allowance here from quietly becoming permission to write records.
 */
interface AccountWriter {
  /** Why this module may call `apiSend` at all. */
  why: string
  /**
   * Set when the module legitimately writes a WORKSPACE-SCOPED path.
   *
   * Exactly one module qualifies and it is not a loophole: `sales.user_preferences`
   * is keyed on (user, workspace), so the caller's own display preference has a
   * workspace in its path while being nobody else's data. Every other
   * workspace-scoped write is a shared record and belongs in `lib/mutations.ts`.
   *
   * It has to be DECLARED rather than inferred, because "workspace-scoped" and
   * "shared record" are the same shape from the outside. An undeclared one fails.
   */
  workspaceScoped?: string
}

const ACCOUNT_WRITERS = new Map<string, AccountWriter>([
  [
    'components/cli-authorize-form.tsx',
    { why: '`bk login` mints a platform token — POST /api/cli/authorize' },
  ],
  ['components/settings/profile-settings.tsx', { why: 'your blackcode profile — PATCH /api/me' }],
  [
    'components/settings/account-settings.tsx',
    {
      why:
        'deleting your data IN THIS APP — DELETE /api/me/footprint, added 2026-08-11 ' +
        'with app-aware account deletion. Not workspace-scoped and not gateable: ' +
        'read-only is a browser display preference, and a preference that could stop ' +
        'somebody deleting their own data would be a permission over their account ' +
        '(D-7), which is the same reasoning accept-invitation.tsx carries. Note the ' +
        'route is /api/me/*, not /api/workspaces/*, and that is not an accident of ' +
        'naming: it deletes the caller\'s own tenancy in this app rather than a record ' +
        'inside a workspace, so there is no workspace in its path to declare',
    },
  ],
  ['components/settings/token-settings.tsx', { why: 'platform API tokens — /api/tokens' }],
  [
    'components/workspace-switcher.tsx',
    {
      why:
        'choosing WHICH workspace you are looking at — POST /api/me/active-workspace, ' +
        'added 2026-08-11 with the sidebar switcher. Deliberately NOT behind ' +
        'useCanWrite(): read-only is a display preference about this app\'s RECORDS, ' +
        'and refusing to let somebody move between workspaces they belong to would ' +
        'make it a permission over their account instead (D-7) — the same reasoning ' +
        'accept-invitation.tsx and account-settings.tsx carry. The route is ' +
        '/api/me/*, not /api/workspaces/*: it writes a pointer in sales.user_settings, ' +
        'not a record inside a workspace',
    },
  ],
  [
    'components/password-reset-flow.tsx',
    {
      why:
        'changing YOUR OWN blackcode password — POST /api/{me/password,auth/password-reset}/* , ' +
        'added 2026-08-11 when this app gained an email sender and stopped pointing ' +
        'people at another app for a password both apps share. Not workspace-scoped ' +
        'and not gateable, for accept-invitation.tsx\'s reason exactly: read-only is a ' +
        'browser display PREFERENCE, and a preference that could stop somebody ' +
        'recovering their own account would be a permission over that account (D-7). ' +
        'The logged-out half is not gateable in any case — it renders on /login, where ' +
        'there is no session to hold a preference',
    },
  ],
  [
    'components/login-form.tsx',
    {
      why:
        'creating an account — POST /api/auth/register, added 2026-08-11 with this ' +
        'app\'s sign-up screen. It runs with NO SESSION, so there is no ui_mode to ' +
        'consult and nothing for read-only to mean; the only gate that matters here ' +
        'is the whitelist, which is server-side in the route and asserted by ' +
        'lib/auth/register-gate.test.ts',
    },
  ],
  [
    'components/accept-invitation.tsx',
    { why: 'accepting or declining an invitation — POST /api/invitations/{accept,decline}, ' +
      'added 2026-08-10 with this app\'s own invitations. It is NOT workspace-scoped ' +
      'and must not be gateable: read-only is a browser display preference, and a ' +
      'preference that could stop somebody joining the app at all would be a ' +
      'permission over their account (D-7). Note that INVITING and REMOVING are the ' +
      'other way round — those are `sales.workspace_members` rows and live in ' +
      'lib/mutations.ts behind useCanWrite(), which is where the path rule below put ' +
      'them.' },
  ],
  [
    'components/settings/preference-settings.tsx',
    {
      why:
        'the ui_mode switch itself. It cannot go through `useRecordMutation`: that ' +
        'one refuses in read-only, and a switch you could not switch back would be ' +
        'a lock rather than a preference.',
      workspaceScoped:
        '`sales.user_preferences` is keyed on (user, workspace), so this write is ' +
        'workspace-scoped while being the caller\'s own setting rather than a ' +
        'shared record. Declared here because the path rule below cannot tell the ' +
        'two apart, and an undeclared workspace-scoped write must fail.',
    },
  ],
])

/**
 * A write aimed at a sales RECORD rather than at the account.
 *
 * ===========================================================================
 * WIDENED 2026-08-10 — THE FIRST VERSION MISSED THE TWO COMMON SPELLINGS
 * ===========================================================================
 * It was `/(['"])\/api\/workspaces\//` — a quote, then the literal path. That
 * matches only a single- or double-quoted constant path, and a record path is
 * almost never one, because it carries the workspace and a number:
 *
 *   1. **A template literal.** `` `/api/workspaces/${ws}/members/1` `` starts
 *      with a BACKTICK, which the character class did not include. Any path with
 *      an interpolated id — i.e. every record path written by hand — was
 *      invisible to this rule.
 *   2. **`wsPath(ws, '/members/1')`.** The app's own helper builds the prefix
 *      (`lib/client.ts`), so a module using it contains no `/api/workspaces/`
 *      text at all. This is the spelling the rest of the app actually uses.
 *
 * Neither hole mattered while `ACCOUNT_WRITERS` held four modules that all wrote
 * constant `/api/me` and `/api/tokens` paths. It started mattering the moment
 * `components/accept-invitation.tsx` was added to that list — an allowed module
 * whose neighbours in this app write through `wsPath`. Found by STEP 2 of the
 * standing rule ("what would this still pass on?"): injecting a workspace path
 * into an allowed module left the suite GREEN, and the injection was the natural
 * spelling rather than a contrived one. CLAUDE.md finding #11's mechanism — the
 * granularity of a text scan is part of what it checks.
 *
 * All three alternatives are watched failing individually; see the header.
 */
const WORKSPACE_PATH = /(['"`])\/api\/workspaces\/|\bwsPath\s*\(/

describe('the inputs', () => {
  it('found the modules this file is about', () => {
    expect(SOURCES.length, `nothing walked under ${APP_ROOT}`).toBeGreaterThan(30)
    for (const f of [TRANSPORT, RECORD_WRITES, ...ACCOUNT_WRITERS.keys()]) {
      expect(existsSync(join(APP_ROOT, f)), `${f} does not exist — this file is stale`).toBe(true)
    }
  })

  it('the record-write module really does gate on the mode', () => {
    // Without this, every assertion below would still pass against a
    // `lib/mutations.ts` that had quietly stopped reading `useCanWrite` — the
    // whole point being funnelled through one ungated function.
    //
    // `codeOf`, not the raw source. This module's own header says it "reads
    // `useCanWrite()`" — so a raw match would be satisfied by the SENTENCE
    // claiming the property, which is the most direct form of a check passing
    // on its own documentation.
    const src = codeOf(readFileSync(join(APP_ROOT, RECORD_WRITES), 'utf8'))
    expect(src, `${RECORD_WRITES} no longer reads useCanWrite`).toMatch(/\buseCanWrite\(/)
    expect(src, `${RECORD_WRITES} no longer refuses in read-only`).toMatch(/throw new ReadOnlyModeError/)
  })
})

describe('read-only is a property of the tree', () => {
  it('there is exactly one fetch() in the whole web surface', () => {
    const callers = SOURCES.filter((f) => /\bfetch\s*\(/.test(codeOf(readFileSync(f, 'utf8')))).map(rel)
    expect(
      callers,
      `only ${TRANSPORT} may call fetch. A component that calls it directly makes ` +
        '"no mutation reaches the network except through the module that documents ' +
        'them" unverifiable, which is the difference between a property and a ' +
        `promise:\n${callers.join('\n')}`
    ).toEqual([TRANSPORT])
  })

  it('only lib/mutations.ts and the named account modules send apiSend', () => {
    const callers = SOURCES.filter((f) => {
      const r = rel(f)
      if (r === TRANSPORT || r === RECORD_WRITES) return false
      return /\bapiSend\s*[<(]/.test(codeOf(readFileSync(f, 'utf8')))
    }).map(rel)

    const unexpected = callers.filter((c) => !ACCOUNT_WRITERS.has(c))
    expect(
      unexpected,
      'these modules write without going through lib/mutations.ts, so their writes ' +
        'are not behind the affordance switch. Add the hook there, or — if it is an ' +
        'ACCOUNT operation rather than a sales record — add it to ACCOUNT_WRITERS ' +
        `with a reason:\n${unexpected.join('\n')}`
    ).toEqual([])
  })

  it('no module outside lib/mutations.ts names an /api/workspaces path in a write', () => {
    // The rule that keeps ACCOUNT_WRITERS honest. Being allowed to call apiSend
    // is not permission to write a RECORD, and the two are told apart by the
    // path: `/api/me` and `/api/tokens` are the account, `/api/workspaces/…` is
    // this app's data.
    const offenders: string[] = []
    for (const [file, entry] of ACCOUNT_WRITERS) {
      if (entry.workspaceScoped) continue
      const src = codeOf(readFileSync(join(APP_ROOT, file), 'utf8'))
      if (/\bapiSend\s*[<(]/.test(src) && WORKSPACE_PATH.test(src)) offenders.push(file)
    }
    expect(
      offenders,
      'an account-surface module is sending a write at a workspace-scoped path. ' +
        'That is a sales record and it belongs in lib/mutations.ts, behind ' +
        `useCanWrite():\n${offenders.join('\n')}`
    ).toEqual([])
  })

  // An exemption that has outlived its reason is coverage quietly dropped —
  // the same rule `cli-parity.test.ts` applies to EXCLUDED_PATHS. A module that
  // declares `workspaceScoped` and no longer writes such a path is exempt from a
  // rule it no longer needs, and the next workspace-scoped write somebody adds
  // to it passes unseen.
  it('every workspaceScoped declaration is still true', () => {
    const stale: string[] = []
    for (const [file, entry] of ACCOUNT_WRITERS) {
      if (!entry.workspaceScoped) continue
      const src = codeOf(readFileSync(join(APP_ROOT, file), 'utf8'))
      if (!WORKSPACE_PATH.test(src)) stale.push(`${file} — "${entry.workspaceScoped}"`)
    }
    expect(
      stale,
      'these modules are exempt from the workspace-path rule and no longer write ' +
        `one. Delete the declaration:\n${stale.join('\n')}`
    ).toEqual([])
  })

  // ===========================================================================
  // ADDED 2026-08-11, AFTER THE BROWSER PASS FOUND WHAT THIS FILE DISCLAIMED
  // ===========================================================================
  // This file's header used to say, in as many words: "What this does NOT claim:
  // that every button is correctly hidden." That disclaimer was honest and it
  // was also the hole — `components/settings/member-settings.tsx` shipped
  // rendering a live-looking Invite field and enabled Remove/Revoke buttons in
  // `read_only`, which is the DEFAULT mode, while every other surface in the app
  // hid its controls and said why.
  //
  // Nothing was ever written and the refusal was loud (measured: the click
  // raises the `ReadOnlyModeError` toast). That is precisely why it survived —
  // the safety net held, so the wrong affordance underneath it cost nothing
  // visible until somebody opened the page in a browser.
  //
  // "Every button is correctly hidden" is not checkable by grep. **"Every
  // component that can start a record write has consulted the mode" is**, and it
  // is the property that makes the first one somebody's deliberate decision
  // rather than an oversight.
  //
  // WHAT IT STILL PASSES ON, stated rather than discovered later:
  //   * A component that calls `useCanWrite()` and ignores the answer.
  //   * A gate on the wrong branch — hiding Remove and not Invite.
  //   * A parent that gates the wrong child. `gatedBy` is checked to consult the
  //     mode, not to render this particular component.
  it('every component that can start a record write has consulted the mode', () => {
    // Components that import a mutation hook but do NOT ask themselves, because
    // a parent has already asked and renders them only when it may. Each entry
    // names the parent, and the case below verifies that parent still asks.
    const GATED_BY_PARENT = new Map<string, string>([
      [
        'components/ledgers/ledger-forms.tsx',
        // The forms are only ever mounted from the ledger pages' `canWrite`
        // branch; they are the editing surface itself, not a page.
        'components/ledgers/ledger-pages.tsx',
      ],
      [
        'components/prospects/prospect-forms.tsx',
        // Same shape. Worth a note: this module's HEADER says it composes "the
        // one `useMutation` that reads `useCanWrite()`", and a scan of the raw
        // source is satisfied by that sentence — the module never calls it. That
        // is the check passing on its own documentation (finding #4), and it is
        // the reason this case reads `codeOf(...)` rather than the file.
        'components/prospects/prospect-detail.tsx',
      ],
      [
        'components/strategies/strategy-forms.tsx',
        // Same shape again (#37). `AddStrategyForm` is mounted only inside the
        // page's `WriteGate`, and `EditStrategyForm` only inside its
        // `canWrite &&` branch — so the forms are the editing surface, never a
        // thing a read-only viewer can reach.
        'components/strategies/strategies-page.tsx',
      ],
    ])

    const ungated: string[] = []
    for (const file of SOURCES) {
      const name = rel(file)
      if (!name.startsWith('components/') && !name.startsWith('app/')) continue
      const src = codeOf(readFileSync(file, 'utf8'))
      // Importing the module is the trigger, not calling a particular hook: a
      // new hook added to lib/mutations.ts is covered without anyone updating a
      // list here.
      if (!/from '@\/lib\/mutations'/.test(src)) continue
      if (/\buseCanWrite\s*\(/.test(src)) continue

      const parent = GATED_BY_PARENT.get(name)
      if (!parent) {
        ungated.push(
          `${name} — imports @/lib/mutations and never calls useCanWrite(). Either ` +
            'gate its affordances (and show READ_ONLY_NOTE where you hide one), or ' +
            'declare the parent that gates it in GATED_BY_PARENT with a reason.'
        )
        continue
      }
      const parentSrc = codeOf(readFileSync(join(APP_ROOT, parent), 'utf8'))
      if (!/\buseCanWrite\s*\(/.test(parentSrc)) {
        ungated.push(
          `${name} — declares it is gated by ${parent}, and ${parent} no longer ` +
            'calls useCanWrite(). The declaration is now false, so BOTH are ungated.'
        )
      }
    }

    // Assert the input. A rename of `lib/mutations.ts`, or an import spelling
    // this regex does not know, would empty the loop and pass silently — which
    // is the shape of thing this whole file exists to catch.
    const importers = SOURCES.filter(
      (f) =>
        (rel(f).startsWith('components/') || rel(f).startsWith('app/')) &&
        /from '@\/lib\/mutations'/.test(codeOf(readFileSync(f, 'utf8')))
    )
    expect(
      importers.length,
      'no component imports @/lib/mutations. Either the module moved or the ' +
        'import spelling changed — and either way the check above scanned nothing.'
    ).toBeGreaterThan(0)

    expect(ungated, ungated.join('\n')).toEqual([])
  })

  it('lib/mutations.ts has exactly one useMutation, and it is the gated one', () => {
    const src = codeOf(readFileSync(join(APP_ROOT, RECORD_WRITES), 'utf8'))
    const count = (src.match(/\buseMutation\s*\(/g) ?? []).length
    expect(
      count,
      'every record write must compose `useRecordMutation`, which is the single ' +
        '`useMutation` in this module and the only place `useCanWrite()` is read. ' +
        'A second one is not necessarily ungated — but the moment there are two, ' +
        'nobody can tell by looking, which is exactly what this file exists to ' +
        'prevent.'
    ).toBe(1)
  })
})

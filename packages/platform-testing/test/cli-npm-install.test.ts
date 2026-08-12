// The npm installer's WINDOWS guidance, asserted from a Mac.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS FILE EXISTS AT ALL
// ═══════════════════════════════════════════════════════════════════════════
// `cli/npm/install.js` is the only code that runs on the machine having the
// problem. Issue #20 records a real first run on Windows — four failures before
// a successful login, none of which named its fix — and two of those four are
// install-time: PowerShell's default execution policy refusing npm's `bk.ps1`
// shim, and a half-finished install holding the shim so the retry dies on a raw
// Node `EBUSY`.
//
// Nobody working on this repo has a Windows machine. That is exactly the
// condition under which this repo has shipped untrue things before (the guide's
// Windows section was written by an agent that said in its own report it could
// not test any of it), so the guidance is written as PURE FUNCTIONS of
// (platform, policy) and asserted here. This does not prove the advice is
// correct on Windows — no test here can — it proves the advice is REACHED, on
// the platform and in the states it was written for. What is claimed and what is
// verified are separated in the phase report deliberately.
//
// The trap to avoid when editing: asserting that some string is non-empty.
// `postInstallNotes` always returns lines, so "it returned something" is
// satisfied by every wrong answer. Every assertion below names the specific
// recovery that must be present, and the negative cases assert ABSENCE on the
// platforms where the advice would be wrong.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const require_ = createRequire(import.meta.url)
const installer = require_(resolve(__dirname, '../../../cli/npm/install.js')) as {
  PLATFORM_MAP: Record<string, string>
  detectExecutionPolicy: (runner?: () => unknown) => string | null
  executionPolicyBlocksShim: (policy: string | null) => boolean
  postInstallNotes: (platform: string, binPath: string, policy: string | null) => string[]
  failureMessage: (err: { code?: string; message: string }) => string
}

const notes = (platform: string, policy: string | null) =>
  installer.postInstallNotes(platform, '/somewhere/node_modules/.bin/bk.exe', policy).join('\n')

describe('requiring install.js has no side effects', () => {
  // If the download ran on import, this file would hit the network on every
  // `npm test`. The `require.main === module` guard is what prevents it, and it
  // is invisible in review — assert it.
  it('exports its helpers without downloading anything', () => {
    expect(Object.keys(installer.PLATFORM_MAP)).toContain('win32-x64')
    expect(Object.keys(installer.PLATFORM_MAP)).toContain('win32-arm64')
  })
})

describe('PowerShell execution policy', () => {
  it('treats the three permissive policies as fine', () => {
    for (const policy of ['remotesigned', 'unrestricted', 'bypass']) {
      expect(installer.executionPolicyBlocksShim(policy)).toBe(false)
    }
  })

  it('treats Restricted, AllSigned and Undefined as blocking', () => {
    // `undefined` is the one that matters: it is what a machine that has never
    // been configured reports, and it FALLS BACK to Restricted on client
    // Windows. Reading it as "no policy, so no problem" is the bug.
    for (const policy of ['restricted', 'allsigned', 'undefined']) {
      expect(installer.executionPolicyBlocksShim(policy)).toBe(true)
    }
  })

  it('treats an unreadable policy as blocking, not as fine', () => {
    // `null` is "we could not find out" — PowerShell absent, refusing to start,
    // timing out. The plan for this phase is explicit: if the check is
    // unreliable, print the guidance anyway. A printed line costs nothing; a
    // dead end costs a user.
    expect(installer.executionPolicyBlocksShim(null)).toBe(true)
  })

  it('reads the policy out of the runner, lowercased and trimmed', () => {
    expect(installer.detectExecutionPolicy(() => 'RemoteSigned\r\n')).toBe('remotesigned')
  })

  it('returns null rather than throwing when PowerShell is not there', () => {
    expect(
      installer.detectExecutionPolicy(() => {
        throw Object.assign(new Error('spawn powershell.exe ENOENT'), { code: 'ENOENT' })
      }),
    ).toBeNull()
    expect(installer.detectExecutionPolicy(() => '   ')).toBeNull()
    expect(installer.detectExecutionPolicy(() => 42 as unknown as string)).toBeNull()
  })
})

describe('post-install notes', () => {
  it('names both ways past a blocking execution policy, on Windows', () => {
    const out = notes('win32', 'restricted')
    expect(out).toContain('Set-ExecutionPolicy -Scope CurrentUser RemoteSigned')
    expect(out).toContain('cmd.exe /c bk --version')
    expect(out).toContain('running scripts is disabled')
    // It must say WHICH policy it saw. "Something is wrong" is not a recovery.
    expect(out).toContain('"restricted"')
  })

  it('says so when it could not read the policy, and still prints the fix', () => {
    const out = notes('win32', null)
    expect(out).toContain('Could not read')
    expect(out).toContain('Set-ExecutionPolicy -Scope CurrentUser RemoteSigned')
  })

  it('stays quiet about the policy when the policy already permits the shim', () => {
    const out = notes('win32', 'remotesigned')
    expect(out).not.toContain('Set-ExecutionPolicy')
    expect(out).not.toContain('running scripts is disabled')
  })

  it('gives Windows PATH advice in Windows shells, and never a POSIX export', () => {
    const out = notes('win32', 'remotesigned')
    expect(out).toContain('$env:PATH')
    // NOT `setx PATH`. It was here until 2026-08-12 and this assertion was
    // enforcing it: setx truncates PATH at 1024 chars and copies the system
    // path into user scope. The persistent advice is the .NET API, which does
    // neither. See "nothing suggests setx for PATH" below.
    expect(out).toContain('SetEnvironmentVariable')
    expect(out).not.toContain('setx PATH')
    // The old text printed `export PATH="$(npm prefix -g)/bin:$PATH"` to
    // everybody, Windows included, where it is not a command at all.
    expect(out).not.toContain('export PATH')
    expect(out).toContain('is not recognized')
  })

  it('gives POSIX advice on macOS and Linux, and none of the Windows lines', () => {
    for (const platform of ['darwin', 'linux']) {
      const out = notes(platform, null)
      expect(out).toContain('export PATH="$(npm prefix -g)/bin:$PATH"')
      expect(out).toContain('command not found')
      expect(out).not.toContain('Set-ExecutionPolicy')
      expect(out).not.toContain('setx PATH')
    }
  })

  it('always names the command to run before the file it installed', () => {
    for (const platform of ['darwin', 'win32']) {
      const lines = installer.postInstallNotes(platform, '/np/bk', null)
      expect(lines[0]).toContain('bk --version')
      expect(lines[lines.length - 1]).toBe('(binary: /np/bk)')
    }
  })
})

describe('failure messages name their own exit', () => {
  it('turns EBUSY into the retry instruction, not a raw Node error', () => {
    const out = installer.failureMessage({ code: 'EBUSY', message: 'EBUSY: resource busy' })
    expect(out).toContain('Close every shell')
    expect(out).toContain('re-run the install')
  })

  it('covers the POSIX spelling of the same condition', () => {
    expect(installer.failureMessage({ code: 'ETXTBSY', message: 'x' })).toContain('Close every shell')
  })

  it('turns EACCES into a prefix fix', () => {
    expect(installer.failureMessage({ code: 'EACCES', message: 'x' })).toContain('npm config set prefix')
  })

  it('falls back to the plain download error for anything else', () => {
    const out = installer.failureMessage({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND github.com' })
    expect(out).toBe('Failed to download bk: getaddrinfo ENOTFOUND github.com')
  })
})

// ---------------------------------------------------------------------------
// `setx PATH "%PATH%;…"` MUST NEVER BE SUGGESTED, on any surface.
// ---------------------------------------------------------------------------
// It is the first answer every search result gives for "add to PATH on
// Windows", and it can permanently damage the machine of the person following
// our install instructions:
//
//   1. `setx` TRUNCATES at 1024 characters, silently. A developer PATH is
//      routinely longer than that, and the tail is gone — not restorable from
//      anything setx wrote.
//   2. `%PATH%` expands to SYSTEM + USER joined, and `setx` writes to USER. So
//      it copies every system entry into user scope, where it goes stale the
//      next time the system path changes, and compounds on a second run.
//
// Added 2026-08-12. Phase 6's agent flagged the line as "the one thing that
// needs a human with Windows … that one could be actively unhelpful" and was
// right; this is the guard so it cannot come back through a copy-paste.
//
// Scanned rather than reasoned about: the string can reappear in the installer,
// the guide, the README or a help string, and only a text scan covers all four.
describe('nothing suggests setx for PATH', () => {
  const ROOT = resolve(__dirname, '../../..')
  const FILES = [
    'cli/npm/install.js',
    'cli/internal/guide/topics/platform/02-install-auth.md',
    'cli/README.md',
  ]

  it('THE PREMISE: the files exist and mention PATH', () => {
    for (const f of FILES) {
      const src = readFileSync(resolve(ROOT, f), 'utf8')
      expect(src.length, `${f} is empty`).toBeGreaterThan(0)
    }
  })

  it('no file tells a user to run setx on PATH', () => {
    const offenders: string[] = []
    for (const f of FILES) {
      const src = readFileSync(resolve(ROOT, f), 'utf8')
      // `setx` followed by PATH on the same line, in any casing. A prose
      // mention that WARNS about it is allowed — those say "not setx" or
      // "do not use", so require the command shape (setx then a quote).
      for (const line of src.split('\n')) {
        // Anchored at the START of the line (after whitespace, a backtick from
        // a template literal, or a shell prompt) so it matches a COMMAND and
        // not the prose that warns against one. The first version of this
        // guard matched its own warning in the guide topic.
        if (/^[\s`>$]*setx\s+PATH\s+"/i.test(line)) offenders.push(`${f}: ${line.trim()}`)
      }
    }
    expect(
      offenders,
      'setx truncates PATH at 1024 chars and copies the system path into user ' +
        'scope. Never suggest it; use [Environment]::SetEnvironmentVariable ' +
        `with the 'User' scope instead:\n${offenders.join('\n')}`
    ).toEqual([])
  })
})

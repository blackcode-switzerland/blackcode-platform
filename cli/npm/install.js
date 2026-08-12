#!/usr/bin/env node
const https = require('https')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const VERSION = require('./package.json').version
// Repo renamed bc-issues → blackcode-platform on 2026-08-04. Versions published
// before that still point at the old name; GitHub redirects, so they keep working.
const REPO = 'blackcode-switzerland/blackcode-platform'
const BIN_DIR = path.join(__dirname, 'bin')

const PLATFORM_MAP = {
  'darwin-x64':   `bk-v${VERSION}-darwin-amd64`,
  'darwin-arm64': `bk-v${VERSION}-darwin-arm64`,
  'linux-x64':    `bk-v${VERSION}-linux-amd64`,
  'linux-arm64':  `bk-v${VERSION}-linux-arm64`,
  'win32-x64':    `bk-v${VERSION}-windows-amd64.exe`,
  'win32-arm64':  `bk-v${VERSION}-windows-arm64.exe`,
}

function download(url, dest, redirects = 0) {
  if (redirects > 5) throw new Error('Too many redirects')
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'npm-install' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(download(res.headers.location, dest, redirects + 1))
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }
      const file = fs.createWriteStream(dest)
      res.pipe(file)
      file.on('finish', () => file.close(resolve))
      file.on('error', reject)
    }).on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// WINDOWS. THIS SCRIPT RUNS ON THE MACHINE THAT HAS THE PROBLEM.
// ---------------------------------------------------------------------------
// Issue #20 is a real first run on Windows: four distinct failures before a
// successful login, and not one of them named its own fix. Two of the four are
// this file's to answer, because they happen at install time and this is the
// only code that runs there.
//
//   1. `npm install -g` writes three shims — `bk`, `bk.cmd` and `bk.ps1`.
//      PowerShell resolves `bk.ps1` first, and its DEFAULT execution policy on
//      Windows client SKUs is `Restricted`, which refuses to run it:
//      "cannot be loaded because running scripts is disabled on this system".
//      The package said nothing about it.
//   2. A half-finished install still holds the shim, so the retry — the obvious
//      next thing anybody does — fails with a raw Node `EBUSY`.
//
// DETECT, DO NOT CHANGE. An installer does not get to alter a user's execution
// policy; that is a machine-wide security setting and a `postinstall` hook is
// the last place it should be decided. We look, and we print.
// ---------------------------------------------------------------------------

// Policies under which PowerShell will run an unsigned local .ps1 (the npm
// shim). Everything else — including `Undefined`, which falls back to the
// Restricted default on client Windows — blocks it.
const POLICIES_THAT_ALLOW_THE_SHIM = ['remotesigned', 'unrestricted', 'bypass']

// Returns the effective policy string, or null when we could not find out.
//
// `null` is a real answer and it is treated as "assume blocked" by the caller:
// PowerShell may not be on PATH, may be a Core install with different defaults,
// or may refuse to start at all. Guessing "fine" there is how a user ends up at
// the dead end this exists to remove — a printed line costs nothing.
function detectExecutionPolicy(runner = defaultPowershellRunner) {
  try {
    const out = runner()
    if (typeof out !== 'string') return null
    const policy = out.trim().toLowerCase()
    return policy === '' ? null : policy
  } catch {
    return null
  }
}

function defaultPowershellRunner() {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', 'Get-ExecutionPolicy'],
    { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
  )
}

function executionPolicyBlocksShim(policy) {
  return !POLICIES_THAT_ALLOW_THE_SHIM.includes(policy)
}

// The lines printed after a successful install. Pure and platform-parameterised
// so it can be asserted without a Windows machine — which is the only way this
// gets tested at all, since nobody here has one.
function postInstallNotes(platform, binPath, policy) {
  const lines = [`bk installed. Verify with:  bk --version`]

  if (platform === 'win32') {
    if (executionPolicyBlocksShim(policy)) {
      lines.push(
        ``,
        policy === null
          ? `Could not read this machine's PowerShell execution policy, so assuming the default.`
          : `This machine's PowerShell execution policy is "${policy}".`,
        `PowerShell runs npm's "bk.ps1" shim before "bk.cmd", and that policy blocks unsigned`,
        `scripts — so "bk" will fail with "cannot be loaded because running scripts is disabled`,
        `on this system". Two ways through, pick one:`,
        `  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned   # allow the shim, once (PowerShell)`,
        `  cmd.exe /c bk --version                               # or bypass PowerShell entirely`,
      )
    }
    lines.push(
      ``,
      `If that says "is not recognized", npm's global bin directory is not on your PATH:`,
      `  $env:PATH = "$(npm prefix -g);$env:PATH"     # PowerShell, this session`,
      `  setx PATH "%PATH%;%APPDATA%\\npm"            # persistent, new shells only`,
    )
  } else {
    lines.push(
      `If that says "command not found", npm's global bin directory is not on your PATH:`,
      `  export PATH="$(npm prefix -g)/bin:$PATH"`,
    )
  }

  // NAME THE COMMAND, NOT THE FILE. This used to print only `bk installed to
  // <binPath>` — a path inside node_modules, which is the one place nobody
  // should run it from. A first-contact agent read that line, went looking for
  // the file, and spent six of its first ten commands on it. The shim npm
  // writes into its global bin directory is what you actually run; the binary's
  // location stays, last and parenthesised, for the rare case it matters.
  lines.push(`(binary: ${binPath})`)
  return lines
}

// A failed install must name its own exit, same rule the binary follows.
function failureMessage(err) {
  const code = err && err.code
  if (code === 'EBUSY' || code === 'ETXTBSY' || code === 'EPERM') {
    return [
      `Failed to install bk: ${err.message}`,
      ``,
      `The file is in use — usually a half-finished install, or a "bk" still running in`,
      `another shell. Close every shell that has run bk, then re-run the install.`,
    ].join('\n')
  }
  if (code === 'EACCES') {
    return [
      `Failed to install bk: ${err.message}`,
      ``,
      `No permission to write into npm's global directory. Either re-run with the rights to,`,
      `or point npm somewhere you own:  npm config set prefix ~/.npm-global`,
    ].join('\n')
  }
  return `Failed to download bk: ${err.message}`
}

function main() {
  const key = `${process.platform}-${process.arch}`
  const asset = PLATFORM_MAP[key]

  if (!asset) {
    console.error(`Unsupported platform: ${key}`)
    process.exit(1)
  }

  const url = `https://github.com/${REPO}/releases/download/v${VERSION}/${asset}`
  const isWindows = process.platform === 'win32'
  const binPath = path.join(BIN_DIR, isWindows ? 'bk.exe' : 'bk')

  if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true })

  console.log(`Downloading bk v${VERSION} for ${key}...`)

  download(url, binPath)
    .then(() => {
      if (!isWindows) fs.chmodSync(binPath, 0o755)
      const policy = isWindows ? detectExecutionPolicy() : null
      for (const line of postInstallNotes(process.platform, binPath, policy)) {
        console.log(line)
      }
    })
    .catch((err) => {
      console.error(failureMessage(err))
      process.exit(1)
    })
}

if (require.main === module) main()

module.exports = {
  PLATFORM_MAP,
  detectExecutionPolicy,
  executionPolicyBlocksShim,
  postInstallNotes,
  failureMessage,
}

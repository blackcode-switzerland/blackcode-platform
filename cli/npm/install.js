#!/usr/bin/env node
const https = require('https')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

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

download(url, binPath)
  .then(() => {
    if (!isWindows) fs.chmodSync(binPath, 0o755)
    // NAME THE COMMAND, NOT THE FILE. This used to print only `bk installed to
    // <binPath>` — a path inside node_modules, which is the one place nobody
    // should run it from. A first-contact agent read that line, went looking
    // for the file, and spent six of its first ten commands on it. The shim
    // npm writes into its global bin directory is what you actually run, and
    // the only useful next step is to check that it resolves.
    console.log(`bk installed. Verify with:  bk --version`)
    console.log(`If that says "command not found", npm's global bin directory is not on your PATH:`)
    console.log(`  export PATH="$(npm prefix -g)/bin:$PATH"`)
    console.log(`(binary: ${binPath})`)
  })
  .catch((err) => {
    console.error(`Failed to download bk: ${err.message}`)
    process.exit(1)
  })

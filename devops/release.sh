#!/usr/bin/env bash
# devops/release.sh — release script for the Blackcode platform monorepo
#
# Usage:
#   ./devops/release.sh web <app>        Deploy ONE app to Vercel production
#   ./devops/release.sh cli [bump]       Release the shared `bk` CLI
#   ./devops/release.sh apps             List deployable apps
#   ./devops/release.sh --help
#
# ONE RELEASE PER INVOCATION. The CLI release does not deploy web, and a web
# deploy targets exactly one app. Both are shared surfaces with independent
# audiences: the binary serves every app, an app serves only itself. Bundling
# them meant a CLI release quietly shipped whatever was on main for the web too.
#
# ADDING AN APP: add one line to app_registry() below. Everything else in this
# script is app-agnostic. See docs/adding-an-app.md.

set -euo pipefail

# ── colours ────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "${BLUE}▶${RESET}  $*"; }
success() { echo -e "${GREEN}✓${RESET}  $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET}  $*"; }
error()   { echo -e "${RED}✗${RESET}  $*" >&2; }
header()  { echo -e "\n${BOLD}$*${RESET}"; }
die()     { error "$*"; exit 1; }

# ── app registry ───────────────────────────────────────────────────────────
# slug|vercel project name|vercel project id|production url
#
# One line per deployable app. `apps/_template` is deliberately ABSENT: the
# scaffold must never be deployed, and leaving it out of this list is what makes
# that true rather than merely documented.
#
# The Vercel project id is used via VERCEL_PROJECT_ID, which overrides whatever
# .vercel/project.json happens to be linked. Without it, deploying a second app
# would silently ship to whichever project the working copy was last linked to —
# the kind of mistake that is only visible after it is live.
# WHEN YOU ADD A LINE, RE-READ "RELEASING THE CLI" IN usage() BELOW. The version
# gate is served by EVERY app (packages/platform-api's apiHandler sets
# X-BK-CLI-Latest / X-BK-CLI-Min on every response, from the one shared
# constant), so step 3 of a CLI release is one `web <app>` per line here — not
# one. This script prints that list for you rather than naming `issues`.
app_registry() {
  cat <<'APPS'
issues|bc-issues|prj_bueHX5y2f7uaemskB5Q1Plwbry2p|https://issues.blackcode.ch
sales|bc-sales|prj_p5A74QYKnig8696ES87bT6rvHMdZ|https://sales.blackcode.ch
books|bc-books|prj_OjkZc6y1oRGkCw3fFtTglIMCN9Ec|https://books.blackcode.ch
APPS
}

VERCEL_ORG_ID_VALUE="team_b4wX7DvsnUaeqJyLi5cGrlbQ"

list_apps() {
  header "Deployable apps"
  app_registry | while IFS='|' read -r slug project _id url; do
    printf "  %-12s %-16s %s\n" "$slug" "$project" "$url"
  done
  echo
  info "Deploy one with: $(basename "$0") web <app>"
}

# Look up an app; dies with the list if the slug is unknown.
resolve_app() {
  local want="$1" line
  line=$(app_registry | grep "^${want}|" || true)
  if [[ -z "$line" ]]; then
    error "Unknown app '${want}'."
    echo
    list_apps
    exit 1
  fi
  echo "$line"
}

# ── helpers ────────────────────────────────────────────────────────────────
require_cmd() {
  if ! command -v "$1" &>/dev/null; then
    die "'$1' is not installed. $2"
  fi
}

check_git_clean() {
  if [[ -n "$(git status --porcelain)" ]]; then
    warn "Working tree has uncommitted changes:"
    git status --short
    echo
    read -r -p "Continue anyway? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || die "Aborted."
  fi
}

# A CLI release must NOT proceed on a dirty tree — this is a hard failure, not a
# prompt. The Makefile stamps the binary with `git describe --tags --dirty`, so
# an unclean tree produces `bk-vX.Y.Z-dirty-*` while the release step looks for
# `bk-vX.Y.Z-*`. The mismatch surfaces only AFTER the release commit is pushed,
# the tag is pushed, and the binaries are built — leaving a published tag with no
# GitHub release and nothing on npm.
#
# Hit for real on v2.0.0, 2026-08-06. The soft prompt above is fine for a web
# deploy, where nothing is stamped and nothing is irreversible.
require_git_clean_for_release() {
  if [[ -n "$(git status --porcelain)" ]]; then
    error "Working tree is not clean. A CLI release cannot proceed."
    echo
    git status --short
    echo
    echo "  The binary is stamped with 'git describe --tags --dirty', so these"
    echo "  changes would produce bk-<version>-dirty-* and the GitHub release"
    echo "  step would fail after the tag was already pushed."
    echo
    echo "  Commit or stash them, then re-run."
    exit 1
  fi
  success "Working tree clean."
}

check_git_branch() {
  local branch
  branch=$(git rev-parse --abbrev-ref HEAD)
  if [[ "$branch" != "main" ]]; then
    warn "You are on branch '${branch}', not 'main'."
    read -r -p "Continue anyway? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || die "Aborted."
  fi
}

check_vercel_auth() {
  require_cmd vercel "Install with: npm install -g vercel"
  local whoami
  whoami=$(vercel whoami 2>&1) || die "Not logged in to Vercel. Run: vercel login"
  success "Vercel: logged in as ${whoami}"
}

check_gh_auth() {
  require_cmd gh "Install with: brew install gh"
  if ! gh auth status &>/dev/null; then
    die "Not logged in to GitHub CLI. Run: gh auth login"
  fi
  local user
  user=$(gh api user --jq '.login' 2>&1) || die "GitHub CLI auth check failed: ${user}"
  success "GitHub: logged in as ${user}"
}

check_npm_auth() {
  require_cmd npm "Install Node.js from https://nodejs.org"
  local user
  user=$(npm whoami 2>&1) || die "Not logged in to npm. Run: npm login"
  success "npm: logged in as ${user}"
}

# ── usage ──────────────────────────────────────────────────────────────────
usage() {
  echo -e "
${BOLD}Blackcode platform release script${RESET}

${BOLD}ONE RELEASE PER INVOCATION.${RESET} A CLI release never deploys an app; a web
deploy targets exactly one app.

${BOLD}USAGE${RESET}
  $(basename "$0") web <app>          Deploy ONE app to Vercel production
  $(basename "$0") cli [bump]         Release the shared \`bk\` CLI to GitHub + npm.
                                      Omit [bump] to be prompted. Also asks
                                      force-vs-normal, and updates cli-version.ts.
  $(basename "$0") apps               List deployable apps
  $(basename "$0") --help             Show this help

${BOLD}BUMP OPTIONS${RESET}
  patch      Bug fix          v1.0.0 → v1.0.1
  minor      New feature      v1.0.0 → v1.1.0
  major      Breaking change  v1.0.0 → v2.0.0
  vX.Y.Z     Explicit version (e.g. v1.2.3)

${BOLD}EXAMPLES${RESET}
  $(basename "$0") apps
  $(basename "$0") web issues
  $(basename "$0") cli minor

${BOLD}RELEASING THE CLI — THREE STEPS, IN THIS ORDER${RESET}
  1. $(basename "$0") web <app>   deploy EVERY app first; each must be
                                  backwards compatible with installed clients
  2. $(basename "$0") cli minor   publish to npm
  3. $(basename "$0") web <app>   AGAIN, for EVERY app — this is what makes the
                                  version gate live. The one people skip.

  The gate (cli-version.ts) is bumped in a commit this script creates itself, so
  it always lands AFTER step 1. Without step 3, production keeps advertising the
  old version and no installed client is told an update exists.

  ${BOLD}Steps 1 and 3 are once PER APP, not once.${RESET} Every deployment answers the
  version question — apiHandler stamps X-BK-CLI-Latest and X-BK-CLI-Min on every
  response from the same shared constant — and \`bk\` asks whichever host it is
  pointed at. Deploy only one and a user whose home app is the other is told
  nothing; on a FORCED release, one host blocks them and the other does not.
  \`$(basename "$0") apps\` lists which apps that currently means.

${BOLD}ADDING AN APP${RESET}
  Add one line to app_registry() near the top of this file. Everything else here
  is app-agnostic. See docs/adding-an-app.md.

${BOLD}PREREQUISITES${RESET}
  web   vercel CLI logged in (vercel login)
  cli   gh CLI logged in (gh auth login), npm logged in (npm login),
        OTP authenticator app ready for npm publish
"
}

# ── web release ────────────────────────────────────────────────────────────
release_web() {
  local app="${1:-}"

  if [[ -z "$app" ]]; then
    error "Which app? A web release targets exactly one."
    echo
    list_apps
    exit 1
  fi

  local entry slug project project_id prod_url
  entry=$(resolve_app "$app")
  IFS='|' read -r slug project project_id prod_url <<< "$entry"

  header "🌐  Web release: ${slug} → Vercel production"
  echo -e "  Project:     ${BOLD}${project}${RESET}"
  echo -e "  Production:  ${prod_url}"
  echo

  # preflight
  info "Running preflight checks..."
  check_vercel_auth
  check_git_branch
  check_git_clean

  local go
  read -r -p "Deploy ${slug} to production? [y/N] " go
  [[ "$go" =~ ^[Yy]$ ]] || die "Aborted."

  # Deploy FROM THE REPO ROOT. Vercel applies each project's own Root Directory
  # setting. Running this from inside apps/<app> uploads only that directory and
  # `npm install` then 404s on the workspace packages — a real failure, found the
  # hard way during the platform migration.
  local script_dir root_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  root_dir="$(cd "${script_dir}/.." && pwd)"
  cd "$root_dir"

  header "Deploying ${slug}..."
  VERCEL_ORG_ID="$VERCEL_ORG_ID_VALUE" VERCEL_PROJECT_ID="$project_id" \
    vercel --prod 2>&1 | while IFS= read -r line; do
      echo "  ${line}"
    done

  echo
  success "Deployment complete."
  info  "Production URL:   ${prod_url}"
  info  "Vercel dashboard: https://vercel.com/balathanusans-projects-f76f8a7b/${project}"
}

# ── bump version ───────────────────────────────────────────────────────────
resolve_version() {
  local bump="${1:-}"

  if [[ -z "$bump" ]]; then
    die "Version bump required. Usage: $(basename "$0") cli <patch|minor|major|vX.Y.Z>"
  fi

  # explicit version tag passed (e.g. v1.2.3)
  if [[ "$bump" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "$bump"
    return
  fi

  if [[ "$bump" != "patch" && "$bump" != "minor" && "$bump" != "major" ]]; then
    die "Invalid argument '${bump}'. Use: patch, minor, major, or vX.Y.Z"
  fi

  # find latest semver tag
  local latest
  latest=$(git tag --list 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)

  if [[ -z "$latest" ]]; then
    die "No existing version tags found. Create the first release manually: $(basename "$0") cli v1.0.0"
  fi

  local major minor patch
  major=$(echo "$latest" | cut -d. -f1 | tr -d 'v')
  minor=$(echo "$latest" | cut -d. -f2)
  patch=$(echo "$latest" | cut -d. -f3)

  case "$bump" in
    major) major=$((major + 1)); minor=0; patch=0 ;;
    minor) minor=$((minor + 1)); patch=0 ;;
    patch) patch=$((patch + 1)) ;;
  esac

  echo "v${major}.${minor}.${patch}"
}

# ── cli release ────────────────────────────────────────────────────────────
release_cli() {
  local bump="${1:-}"

  # Interactive bump selection if not passed as an argument.
  if [[ -z "$bump" ]]; then
    echo
    header "Version bump"
    echo "  1) patch     bug fix          (v1.0.0 → v1.0.1)"
    echo "  2) minor     new feature      (v1.0.0 → v1.1.0)"
    echo "  3) major     breaking change  (v1.0.0 → v2.0.0)"
    echo "  4) explicit  type an exact vX.Y.Z"
    local choice
    read -r -p "Select [1-4]: " choice
    case "$choice" in
      1) bump="patch" ;;
      2) bump="minor" ;;
      3) bump="major" ;;
      4) read -r -p "Version (vX.Y.Z): " bump ;;
      *) die "Invalid selection '${choice}'." ;;
    esac
  fi

  local version
  version=$(resolve_version "$bump")
  local version_number="${version#v}"   # strip leading 'v' for package.json

  # Upgrade policy — drives the server version gate (cli-version.ts):
  #   normal → CLI_LATEST advertises the new version (soft "update available").
  #   forced → also raise CLI_MIN so older CLIs are hard-blocked (exit code 8).
  echo
  header "Upgrade policy"
  echo "  normal — advertise ${version} as latest; older CLIs get a soft update notice."
  echo "  forced — also raise CLI_MIN to ${version}; older CLIs are blocked until they upgrade."
  local force_ans forced=false
  read -r -p "Force upgrade? [y/N] " force_ans
  if [[ "$force_ans" =~ ^[Yy]$ ]]; then forced=true; fi

  # Confirm before anything irreversible (commit / tag / publish).
  echo
  header "Release plan"
  echo -e "  CLI version:  ${BOLD}${version}${RESET}"
  if [[ "$forced" == true ]]; then
    echo -e "  Policy:       ${BOLD}FORCED${RESET} — sets CLI_LATEST and CLI_MIN to ${version}"
    echo
    warn "FORCED blocks every older binary with exit 8 the moment the gate goes live."
    warn "Publish first (this script does), then deploy web. Anyone who has not"
    warn "upgraded is locked out until they run: npm install -g ${npm_package:-@blackcode_sa/bc-issues}@latest"
  else
    echo -e "  Policy:       normal — sets CLI_LATEST to ${version} (CLI_MIN unchanged)"
  fi
  echo -e "  Deploy web:   ${BOLD}no${RESET} — a CLI release never deploys an app"
  local go
  read -r -p "Proceed? [y/N] " go
  [[ "$go" =~ ^[Yy]$ ]] || die "Aborted."
  local repo="blackcode-switzerland/blackcode-platform"
  local npm_package="@blackcode_sa/bc-issues"
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local root_dir
  root_dir="$(cd "${script_dir}/.." && pwd)"
  local cli_dir="${root_dir}/cli"
  local npm_dir="${cli_dir}/npm"

  header "📦  CLI release ${version} (${bump}) → GitHub + npm"

  # preflight
  info "Running preflight checks..."
  check_gh_auth
  check_npm_auth
  check_git_branch
  require_git_clean_for_release

  # check tag doesn't already exist
  if git tag --list | grep -q "^${version}$"; then
    die "Git tag '${version}' already exists. Bump the version number."
  fi

  # check npm version doesn't already exist
  if npm view "${npm_package}@${version_number}" version &>/dev/null 2>&1; then
    die "npm version ${version_number} already published. Bump the version number."
  fi

  success "All preflight checks passed."

  # bump versions in npm package files
  header "Bumping version to ${version_number}..."
  local pkg_json="${npm_dir}/package.json"
  local install_js="${npm_dir}/install.js"

  # update package.json version
  sed -i '' "s/\"version\": \".*\"/\"version\": \"${version_number}\"/" "$pkg_json"
  # update install.js VERSION constant
  sed -i '' "s/^const VERSION = '.*'/const VERSION = '${version_number}'/" "$install_js"
  success "Updated ${pkg_json}"
  success "Updated ${install_js}"

  # Update the server-side version gate now so it lands in the SAME commit as the
  # bump (one commit, then the tag/build/publish come from it). CLI_LATEST always;
  # CLI_MIN only when forced.
  #
  # The gate has now moved twice, so it is SEARCHED FOR rather than hardcoded.
  #
  # History, because it is the reason for the search: it was <root>/lib/cli-version.ts
  # until Phase 1 put the app under apps/issues/, and this path was not updated
  # with it — so every release since would have died here on `sed: no such file`,
  # after bumping package.json and install.js and before the release commit.
  # Caught in Phase 5, the first release attempt after the move. Phase 6 then
  # moved it again, into packages/platform-agent/, because one binary has one
  # advertised version and a second app must not answer that question differently.
  #
  # A hardcoded path that breaks halfway through a release is a bad trade for the
  # two lines this costs. The candidate list is ordered newest-first and the
  # failure names every place it looked.
  local cli_version_ts=""
  local candidate
  for candidate in \
    "${root_dir}/packages/platform-agent/src/cli-version.ts" \
    "${root_dir}/apps/issues/lib/cli-version.ts" \
    "${root_dir}/lib/cli-version.ts"; do
    if [[ -f "$candidate" ]]; then cli_version_ts="$candidate"; break; fi
  done
  [[ -n "$cli_version_ts" ]] || die "Version gate (cli-version.ts) not found in packages/platform-agent/src, apps/issues/lib or <root>/lib — has it moved again?"
  info "Version gate: ${cli_version_ts#$root_dir/}"
  sed -i '' -E "s/(CLI_LATEST_VERSION = process\.env\.BK_CLI_LATEST \?\? ')[^']*'/\1${version_number}'/" "$cli_version_ts"
  success "CLI_LATEST_VERSION → ${version_number}"
  if [[ "$forced" == true ]]; then
    sed -i '' -E "s/(CLI_MIN_VERSION = process\.env\.BK_CLI_MIN \?\? ')[^']*'/\1${version_number}'/" "$cli_version_ts"
    success "CLI_MIN_VERSION → ${version_number} (forced)"
  fi

  # Single release commit: package bump + install.js + version gate.
  info "Committing release ${version}..."
  git add "$pkg_json" "$install_js" "$cli_version_ts"
  git commit -m "chore: release CLI ${version}$([[ "$forced" == true ]] && echo ' (forced min)')"
  git push origin main
  success "Pushed release commit."

  # tag
  info "Creating git tag ${version}..."
  git tag "$version"
  git push origin "$version"
  success "Pushed tag ${version}."

  # build binaries
  header "Building binaries..."
  cd "$cli_dir"
  make dist 2>&1 | while IFS= read -r line; do echo "  ${line}"; done
  cd "$root_dir"
  success "Binaries built in cli/dist/"

  # create github release
  header "Creating GitHub Release ${version}..."
  local dist_dir="${cli_dir}/dist"
  local bin_name="bk-${version}"

  gh release create "$version" \
    "${dist_dir}/${bin_name}-darwin-amd64" \
    "${dist_dir}/${bin_name}-darwin-arm64" \
    "${dist_dir}/${bin_name}-linux-amd64" \
    "${dist_dir}/${bin_name}-linux-arm64" \
    "${dist_dir}/${bin_name}-windows-amd64.exe" \
    "${dist_dir}/${bin_name}-windows-arm64.exe" \
    "${dist_dir}/SHA256SUMS" \
    --repo "$repo" \
    --title "${version}" \
    --notes "## Install

\`\`\`bash
npm install -g ${npm_package}
\`\`\`

## Usage

\`\`\`bash
bk login --server https://issues.blackcode.ch
bk guide
\`\`\`

## Platforms
- macOS (Intel + Apple Silicon)
- Linux (x64 + arm64)
- Windows (x64 + arm64)" 2>&1 | while IFS= read -r line; do echo "  ${line}"; done

  success "GitHub Release created: https://github.com/${repo}/releases/tag/${version}"

  # publish npm
  header "Publishing to npm..."
  warn "npm will ask for your OTP (2FA code). Have your authenticator app ready."
  echo
  cd "$npm_dir"
  npm publish --access public
  cd "$root_dir"

  echo
  success "npm package published: ${npm_package}@${version_number}"

  # summary
  echo
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${GREEN}${BOLD}  CLI ${version} released successfully!${RESET}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "  GitHub:  https://github.com/${repo}/releases/tag/${version}"
  echo -e "  npm:     https://www.npmjs.com/package/${npm_package}"
  echo -e "  Install: npm install -g ${npm_package}"
  echo
  if [[ "$forced" == true ]]; then
    echo -e "  Version gate: CLI_LATEST=${version_number} · CLI_MIN=${version_number} (committed, NOT live)"
  else
    echo -e "  Version gate: CLI_LATEST=${version_number} (committed, NOT live)"
  fi

  # The version gate is server-side, and this script bumped it in a commit it
  # made itself — so it only goes live on the NEXT web deploy. Skipping that is
  # how production keeps advertising the previous version and no installed
  # client is ever told an update exists.
  echo
  header "⚠  NOT DONE YET — the version gate is not live"
  echo "  The gate lives in the web apps, and the commit that bumped it was made"
  echo "  by this script. It takes effect only after a web deploy — and EVERY app"
  echo "  answers the version question, so this is one deploy per app:"
  echo
  app_registry | while IFS='|' read -r slug _project _id _url; do
    echo -e "      ${BOLD}$(basename "$0") web ${slug}${RESET}"
  done
  echo
  echo "  Any app you skip keeps advertising the previous version to everyone"
  echo "  whose home app it is."
  echo
  if [[ "$forced" == true ]]; then
    warn "Until you run that, older binaries are NOT yet blocked."
    warn "The moment you do, everyone below ${version_number} gets exit 8."
    echo "  Tell the team before deploying."
  else
    echo "  Until you run that, production still advertises the previous version"
    echo "  and nobody is nudged to upgrade."
  fi
  echo
}

# ── entrypoint ─────────────────────────────────────────────────────────────
COMMAND="${1:-}"

case "$COMMAND" in
  web)
    release_web "${2:-}"
    ;;
  cli)
    release_cli "${2:-}"
    ;;
  apps)
    list_apps
    ;;
  --help|-h|help)
    usage
    ;;
  "")
    usage
    die "No command specified."
    ;;
  *)
    usage
    die "Unknown command '${COMMAND}'. Use 'web <app>', 'cli' or 'apps'."
    ;;
esac

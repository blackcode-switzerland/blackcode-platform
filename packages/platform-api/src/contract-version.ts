// The contract version — one short string an agent can poll to find out whether
// an app's behaviour surface has moved (sales #31).
//
// ===========================================================================
// WHAT PROBLEM THIS SOLVES
// ===========================================================================
// Agents write per-app skill files that hardcode command lists, flags and
// vocabularies as a convenience. Every server change risks the skill going
// silently stale, and the agent's only alternatives are to trust wrong
// information or to re-read the whole `--help` tree and `bk meta` defensively on
// every single run, which is expensive.
//
// `bk skill check` already solved the CLI⇄skill-file half of this by comparing
// two version numbers. This is the same pattern generalised from "is my skill
// file current" to "did this app's SERVER contract change since I last looked".
//
// ===========================================================================
// A DERIVED HASH, NOT A HAND-BUMPED INTEGER — AND THAT IS THE WHOLE DESIGN
// ===========================================================================
// The issue asked for "a single incrementing int or semver". This is neither,
// deliberately.
//
// A hand-maintained number is a second copy of a fact, and this repo's entire
// standing rule is about what happens to those: somebody adds a vocabulary
// value, forgets to bump the integer, and **the version says "nothing changed"
// while something did.** That is strictly worse than having no version at all,
// because an agent that trusts it now skips the re-read it would otherwise have
// done. A guard that reports success while inert — CLAUDE.md's whole table.
//
// A hash over the contract itself cannot be forgotten. It changes if and only if
// the contract changes, and nobody has to remember anything.
//
// ===========================================================================
// WHAT MUST AND MUST NOT GO INTO IT
// ===========================================================================
// IN: the app's declared contract — its vocabularies, its limits, its entity /
// search / trash types. Everything `/api/meta` serves under `apps.<slug>`, which
// is already assembled from the modules that own each piece rather than typed
// out, so this inherits that property.
//
// OUT, and this is the half that makes it useful rather than noise:
//
//   - anything per-USER (workspaces, labels, the caller's identity). Two agents
//     polling the same deployment must get the same answer, or the value cannot
//     be cached or compared between runs.
//   - anything per-DEPLOY (a build id, a commit sha, a timestamp). A version
//     that changes on every deploy is a version that always says "re-read
//     everything", which is exactly the cost this exists to remove. It would
//     look like it was working.
//
// The second one is the failure worth watching for: it is not detectable by
// reading the code, only by deploying twice without a contract change and seeing
// whether the value moved. `contract-version.test.ts` pins both directions.
//
// ===========================================================================
// KEY ORDER MUST NOT MATTER
// ===========================================================================
// `JSON.stringify` preserves insertion order, so `{a:1,b:2}` and `{b:2,a:1}`
// hash differently while describing the identical contract. Reordering two keys
// in a source file is a refactor nobody would expect to invalidate every agent's
// cache. So the serialiser below sorts keys at every depth.
//
// ARRAY order is preserved on purpose, because it is meaningful here: the
// pipeline stages are a ladder and `TRASH_TYPES`' first entry is what the CLI's
// help text suggests. A reordered array IS a contract change.

import { createHash } from 'node:crypto'

/**
 * `JSON.stringify` with object keys sorted at every depth. Arrays keep order.
 *
 * Written out rather than using a `replacer`: a replacer receives each value
 * before nested objects are visited and cannot reliably sort at depth.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value as Record<string, unknown>).sort()
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(',')
  return `{${body}}`
}

/**
 * A short, stable fingerprint of one app's declared contract.
 *
 * Sixteen hex characters of SHA-256. Long enough that an accidental collision
 * between two contracts is not a thing anybody will ever see, short enough to
 * paste into a log line or a skill file's front matter, and it is compared for
 * EQUALITY only — nothing orders these or subtracts them, which is why a hash is
 * an adequate substitute for a counter.
 *
 * Pass exactly the object the app serves under `apps.<slug>` in `/api/meta`.
 * Passing more (a workspace list, a build id) is how this becomes useless; the
 * header says why.
 */
export function contractVersion(currentApp: unknown): string {
  return createHash('sha256').update(stableStringify(currentApp)).digest('hex').slice(0, 16)
}

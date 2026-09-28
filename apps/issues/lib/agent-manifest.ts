// The machine-readable "how to use this programmatically" note embedded on every
// page by <AgentManifest/> (components/agent-manifest.tsx), and the source for
// /llms.txt. The RENDERING lives in @blackcode/platform-agent since 2026-09-28,
// shared with every other app; this file is only this app's values.
//
// This used to be 77 dense lines restating the auth header, every envelope
// shape, the pagination rules, the upload flow, the encoding warning… all of it
// a hand-maintained copy of facts that lived elsewhere, and all of it a drift
// risk. Two of those copies were already wrong when we measured.
//
// It is now a POINTER, not a copy. Everything specific lives in exactly one of
// two places, neither of which can go stale:
//
//   `bk guide` — static behaviour, embedded in the binary being run
//   `bk meta`  — dynamic data (vocabularies, limits, workspaces), fetched live
//
// The rule: nothing may be added here that could ever become false. If you are
// tempted to document a route, an envelope or a limit, it belongs in a guide
// topic or in /api/meta instead.

import { CLI_NPM_PACKAGE, renderAgentManifestNote, type AgentManifest } from '@blackcode/platform-agent'

export const AGENT_MANIFEST = {
  project: 'blackcode issues',
  summary: 'AI-native issue tracker. Agents operate it through the bk CLI.',
  interface: 'CLI only. There is no supported HTTP API.',
  install: `npm install -g ${CLI_NPM_PACKAGE}`,
  start: ['bk login', 'bk skill install', 'bk guide', 'bk meta'],
  package: CLI_NPM_PACKAGE,
  // Where a stuck agent goes. Kept because lib/api/context.ts advertises these
  // on every response as X-BK-Help / X-BK-Changelog.
  //
  // `changelog` points at the JSON route, not a page: the human /changelog page
  // was removed on 2026-08-03 (nobody read it) and these headers are consumed by
  // agents anyway. `bk changelog` is the CLI-side equivalent.
  help: '/agent-updator',
  changelog: '/api/changelog',
  rules: ['Address projects/tasks/issues by their workspace #number.'],
} as const satisfies AgentManifest

// Human-readable prose for agents that scrape the raw HTML rather than parse the
// JSON block. Rendered inside an HTML comment at the top of <body>.
export const AGENT_MANIFEST_NOTE = renderAgentManifestNote(AGENT_MANIFEST)

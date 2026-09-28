// This app's "how to use me programmatically" pointer: the values behind
// /llms.txt, the <AgentManifest/> embedded on every page, and the X-BK-Help /
// X-BK-Changelog headers `lib/api.ts` sets on every API response. Rendered by
// @blackcode/platform-agent — read its `agent-manifest.ts` header for the rule:
// a POINTER, never a copy. No route, vocabulary or limit may appear here.

import { CLI_NPM_PACKAGE, renderAgentManifestNote, type AgentManifest } from '@blackcode/platform-agent'

export const AGENT_MANIFEST = {
  project: 'blackcode sales',
  summary: 'Business development pipeline — prospects, meetings, communications. Agents operate it through the bk CLI.',
  interface: 'CLI only. There is no supported HTTP API.',
  install: `npm install -g ${CLI_NPM_PACKAGE}`,
  start: ['bk login', 'bk skill install', 'bk guide sales/pipeline', 'bk sales workspace use <your-workspace>'],
  package: CLI_NPM_PACKAGE,
  help: '/agent-updator',
  changelog: '/api/changelog',
  rules: ['Every data command is spelled `bk sales <noun> <verb>`; the active workspace is per app.'],
} as const satisfies AgentManifest

export const AGENT_MANIFEST_NOTE = renderAgentManifestNote(AGENT_MANIFEST)

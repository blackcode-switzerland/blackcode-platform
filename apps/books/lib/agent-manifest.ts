// This app's "how to use me programmatically" pointer: the values behind
// /llms.txt, the <AgentManifest/> embedded on every page, and the X-BK-Help /
// X-BK-Changelog headers `lib/api.ts` sets on every API response. Rendered by
// @blackcode/platform-agent — read its `agent-manifest.ts` header for the rule:
// a POINTER, never a copy. No route, vocabulary or limit may appear here.
//
// The name reads `APP_NAME`, never a literal: this app also ships rebranded
// (`lib/app.ts`), and an agent reading another company's page should be told
// that company's product name.

import { CLI_NPM_PACKAGE, renderAgentManifestNote, type AgentManifest } from '@blackcode/platform-agent'
import { APP_NAME } from '@/lib/app'

export const AGENT_MANIFEST = {
  project: APP_NAME,
  summary: 'Swiss statutory bookkeeping. The web app reads; every write is a bk command. Agents operate it through the bk CLI.',
  interface: 'CLI only. There is no supported HTTP API.',
  install: `npm install -g ${CLI_NPM_PACKAGE}`,
  start: ['bk login', 'bk skill install', 'bk guide books', 'bk books workspace use <your-workspace>'],
  package: CLI_NPM_PACKAGE,
  help: '/agent-updator',
  changelog: '/api/changelog',
  rules: ['Every data command is spelled `bk books <noun> <verb>`; the active workspace is per app.'],
} as const satisfies AgentManifest

export const AGENT_MANIFEST_NOTE = renderAgentManifestNote(AGENT_MANIFEST)

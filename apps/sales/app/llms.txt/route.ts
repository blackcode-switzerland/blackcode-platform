// /llms.txt — the convention (llmstxt.org) agents check to learn how to use a
// site. An install funnel, not a reference: everything specific comes from
// `bk guide` (embedded, offline) and `bk meta` (live). Rendered by
// @blackcode/platform-agent from this app's `lib/agent-manifest.ts`, the same
// renderer every app uses.

import { llmsTxtResponse } from '@blackcode/platform-agent'
import { AGENT_MANIFEST } from '@/lib/agent-manifest'

export function GET() {
  return llmsTxtResponse(AGENT_MANIFEST)
}

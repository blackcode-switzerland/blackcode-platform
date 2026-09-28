// /llms.txt — the convention (llmstxt.org) agents check to learn how to use a
// site. Together with the landing page it is now the ONLY discovery surface:
// everything else is reached through `bk`.
//
// It is deliberately an install funnel, not a reference. An agent arriving here
// with no prior knowledge should be able to go from nothing to a working setup
// in four commands, and get every specific from `bk guide` (embedded, offline)
// and `bk meta` (live). Generated from lib/agent-manifest.ts so the commands
// can't drift from the per-page manifest. The text is rendered by
// @blackcode/platform-agent, shared with every app since 2026-09-28.

import { llmsTxtResponse } from '@blackcode/platform-agent'
import { AGENT_MANIFEST } from '@/lib/agent-manifest'

export function GET() {
  return llmsTxtResponse(AGENT_MANIFEST)
}

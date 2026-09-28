import { AGENT_MANIFEST, AGENT_MANIFEST_NOTE } from '@/lib/agent-manifest'

// Machine-readable metadata embedded on every page (rendered once in the root
// layout) so an agent that fetches ANY route — not just the API — learns that
// this app is operated through the `bk` CLI, and where to start. Same component
// as apps/issues' (2026-09-28); the note is rendered by @blackcode/platform-agent.
//
// Renders nothing visible:
//   1. an HTML comment with the prose note (for agents that grep raw HTML), and
//   2. a <script type="application/json"> with the structured manifest.
// No user- or page-specific data, so it is safe on authenticated pages too.
//
// `<` is escaped so the JSON can never prematurely close the <script>.
export function AgentManifest() {
  const json = JSON.stringify(AGENT_MANIFEST).replace(/</g, '\\u003c')
  return (
    <>
      <div
        hidden
        aria-hidden="true"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: `<!--\n${AGENT_MANIFEST_NOTE}\n-->` }}
      />
      <script
        type="application/json"
        id="agent-manifest"
        dangerouslySetInnerHTML={{ __html: json }}
      />
    </>
  )
}

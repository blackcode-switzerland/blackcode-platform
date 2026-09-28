// The "how to use this programmatically" pointer every app serves three ways:
//
//   /llms.txt          renderLlmsTxt(m)            — the llmstxt.org convention
//   every HTML page    renderAgentManifestNote(m)  — an HTML comment + a JSON
//                                                    <script>, for agents that
//                                                    fetch a page, not the API
//   every API response m.help / m.changelog       — X-BK-Help / X-BK-Changelog
//                                                    (platform-api's handler)
//
// ── WHY THIS MOVED HERE (2026-09-28) ─────────────────────────────────────────
// It lived in apps/issues (`lib/agent-manifest.ts`, `app/llms.txt/route.ts`)
// because it had one caller, and this package's header recorded the rule: "if
// you have to add a parameter to make it generic, leave it — under-extracting
// is cheap to fix when the second app asks". Three apps asked at once, when
// sales, books and billing gained their own /agent-updator and /llms.txt so the
// four front doors match. The APP supplies the manifest — its name, its bk
// group, its rules — and this file renders it; the text around those values was
// already identical.
//
// ── THE RULE FOR WHAT GOES IN A MANIFEST ─────────────────────────────────────
// It is a POINTER, not a copy. Nothing may be added that could ever become
// false: no route, no envelope, no vocabulary, no limit. Those live in `bk
// guide` (embedded in the binary being run) and `bk meta` (fetched live). The
// first version of the issues note was 77 lines restating the auth header,
// every envelope and the upload flow, and two of those copies were already
// wrong when measured.

export interface AgentManifest {
  /** The product, as an agent should call it: `blackcode issues`. */
  project: string
  /** One sentence: what it is and that agents use the CLI. */
  summary: string
  /** How it is operated. Every app says the same thing; kept per app so a manifest reads whole. */
  interface: string
  /** The npm package the binary ships in. */
  package: string
  /** `npm install -g <package>`. */
  install: string
  /** The commands, in order, from nothing to working. */
  start: readonly string[]
  /** Where a stuck agent goes — the app's /agent-updator page. */
  help: string
  /** The dated record, as a route (the JSON feed; `bk changelog` is the CLI side). */
  changelog: string
  /** App-specific rules for llms.txt, appended after the common ones. */
  rules?: readonly string[]
}

/**
 * The prose note embedded (as an HTML comment) at the top of every page's body.
 * For agents that grep raw HTML rather than parse the JSON block beside it.
 */
export function renderAgentManifestNote(m: AgentManifest): string {
  return [
    `${m.project} — programmatic access`,
    'This product is operated through a CLI. There is no supported HTTP API.',
    `  ${m.install}`,
    ...m.start.map((s) => `  ${s}`),
    '`bk guide` is the complete usage guide for the binary you just installed, and works offline.',
    '`bk meta` returns your workspaces and the live vocabularies and limits.',
    `Out of date? ${m.help} · What changed: \`bk changelog\` (or ${m.changelog})`,
    'A structured version of this note is in the <script type="application/json" id="agent-manifest"> element on this page.',
  ].join('\n')
}

/**
 * /llms.txt — deliberately an install funnel, not a reference. An agent with no
 * prior knowledge goes from nothing to a working setup in a handful of
 * commands, and gets every specific from `bk guide` and `bk meta`.
 */
export function renderLlmsTxt(m: AgentManifest): string {
  return [
    `# ${m.project}`,
    '',
    `> ${m.summary}`,
    '',
    `${m.interface} Humans use the web UI at /dashboard; agents use the CLI.`,
    '',
    '## Start here',
    '',
    '```',
    m.install,
    ...m.start,
    '```',
    '',
    '- `bk guide` — the complete usage guide for the binary you just installed.',
    '  It ships inside the executable, so it always describes the version in your',
    '  hand. Works offline and unauthenticated. `bk guide --list` for topics,',
    '  `bk guide <topic>` for one, `bk guide --json` for structured output.',
    '- `bk meta` — who you are, every workspace you can write to, the current',
    '  vocabularies, and every server-enforced limit.',
    '  Pick your workspace by NAME or SLUG, never by numeric id.',
    '- `bk <group> <command> --help` — discover flags before calling.',
    '',
    '## Rules',
    '',
    '- Add `--json` to every read command.',
    '- Set `BK_NO_PROMPT=1` for unattended runs.',
    ...(m.rules ?? []).map((r) => `- ${r}`),
    '',
    '## Keeping current',
    '',
    '- If a command that used to work now fails, run `bk skill sync`, then retry.',
    `- [What changed](${m.changelog}) — the dated record (also \`bk changelog\`).`,
    `- [Getting an agent current](${m.help}).`,
    '',
  ].join('\n')
}

/** The Response every app's `app/llms.txt/route.ts` returns. */
export function llmsTxtResponse(m: AgentManifest): Response {
  return new Response(renderLlmsTxt(m), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}

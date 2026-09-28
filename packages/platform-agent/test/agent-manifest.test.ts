import { describe, it, expect } from 'vitest'
import { llmsTxtResponse, renderAgentManifestNote, renderLlmsTxt, type AgentManifest } from '../src/agent-manifest'

const m: AgentManifest = {
  project: 'blackcode example',
  summary: 'An example app.',
  interface: 'CLI only.',
  package: '@example/cli',
  install: 'npm install -g @example/cli',
  start: ['bk login', 'bk guide'],
  help: '/agent-updator',
  changelog: '/api/changelog',
  rules: ['An app-specific rule.'],
}

describe('renderLlmsTxt', () => {
  const txt = renderLlmsTxt(m)

  it('says every value the app supplied — the renderer drops none of them', () => {
    for (const v of [m.project, m.summary, m.interface, m.install, ...m.start, m.help, m.changelog]) {
      expect(txt).toContain(v)
    }
  })

  it("appends the app's own rules after the common ones", () => {
    expect(txt.indexOf('- Set `BK_NO_PROMPT=1`')).toBeLessThan(txt.indexOf('- An app-specific rule.'))
  })

  it('is well-formed without rules', () => {
    const bare = renderLlmsTxt({ ...m, rules: undefined })
    expect(bare).not.toContain('undefined')
    expect(bare).toContain('## Keeping current')
  })
})

describe('renderAgentManifestNote', () => {
  it('names the install, every start command and the help path', () => {
    const note = renderAgentManifestNote(m)
    for (const v of [m.install, ...m.start, m.help]) expect(note).toContain(v)
  })

  it('cannot close the HTML comment it is embedded in', () => {
    expect(renderAgentManifestNote(m)).not.toContain('-->')
  })
})

describe('llmsTxtResponse', () => {
  it('is plain text, cached briefly, carrying the rendered body', async () => {
    const res = llmsTxtResponse(m)
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300')
    expect(await res.text()).toBe(renderLlmsTxt(m))
  })
})

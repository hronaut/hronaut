import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { BROWSER_TOOL_CATALOG } from '../src/main/mcp/server.js'

describe('starter workflow documentation', () => {
  it('links a copy-ready post-connection path from the README', async () => {
    const readme = await readFile('README.md', 'utf8')

    expect(readme).toContain('[copy-ready starter workflows](STARTER_WORKFLOWS.md)')
  })

  it('uses only real MCP tools and preserves the human-control boundary', async () => {
    const guide = await readFile('STARTER_WORKFLOWS.md', 'utf8')
    const catalogNames = new Set(BROWSER_TOOL_CATALOG.map(({ name }) => name))
    const mentionedTools = [...guide.matchAll(/`((?:browser|wallet)_[a-z0-9_]+)`/g)]
      .map((match) => match[1]!)
    const starterPrompts = [...guide.matchAll(/```text\n([\s\S]*?)\n```/g)]
      .map((match) => match[1]!)
      .filter((prompt) => prompt.includes('Create a fresh scratch workspace'))

    expect(new Set(mentionedTools).size).toBeGreaterThanOrEqual(10)
    for (const name of mentionedTools) expect(catalogNames.has(name), name).toBe(true)

    expect(starterPrompts).toHaveLength(3)
    for (const prompt of starterPrompts) {
      expect(prompt.indexOf('`browser_workspaces`')).toBeLessThan(prompt.indexOf('`browser_new_tab`'))
      expect(prompt).not.toContain('`browser_navigate`')
    }

    expect(guide).toContain('Create a fresh scratch workspace')
    expect(guide).toContain('Do not use or inspect the Default workspace')
    expect(guide).toContain('Do not enter credentials, solve CAPTCHA, or approve consent')
    expect(guide).toContain('Pause MCP in Hronaut before entering anything sensitive')
    expect(guide).toContain('Do not request network bodies unless the failure requires them')
    expect(guide).toContain('restore the normal viewport when finished')
    expect(guide).toContain('REFERENCE.md#mcp-tools')
    expect(guide).toContain('docs/WORKSPACE_SITE_ACCESS.md')
  })
})

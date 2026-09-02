import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { BROWSER_TOOL_CATALOG } from '../src/main/mcp/server.js'

describe('Hronaut Agent Skill discovery', () => {
  it('names concrete browser QA intents in its indexed description', async () => {
    const skill = await readFile('skills/hronaut/SKILL.md', 'utf8')
    const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/u)?.[1] ?? ''
    const description = frontmatter.match(/^description:\s*(.+)$/mu)?.[1] ?? ''

    expect(description).toMatch(/Browser MCP/u)
    expect(description).toMatch(/authenticated browser QA/iu)
    expect(description).toMatch(/localhost/iu)
    expect(description).toMatch(/responsive testing/iu)
    expect(description).toMatch(/accessibility/iu)
    expect(description).toMatch(/performance/iu)
  })

  it('keeps its use cases source-backed by the real MCP catalog', async () => {
    const skill = await readFile('skills/hronaut/SKILL.md', 'utf8')
    const catalogNames = new Set(BROWSER_TOOL_CATALOG.map(({ name }) => name))
    const mentionedTools = [...skill.matchAll(/`(browser_[a-z0-9_]+)`/g)]
      .map((match) => match[1]!)

    expect(skill).toContain('## Good fits')
    expect(skill).toContain('authenticated application QA')
    expect(skill).toContain('localhost and preview-environment debugging')
    expect(skill).toContain('responsive, accessibility, and performance checks')
    expect(new Set(mentionedTools).size).toBeGreaterThanOrEqual(12)
    for (const name of mentionedTools) expect(catalogNames.has(name), name).toBe(true)
  })
})

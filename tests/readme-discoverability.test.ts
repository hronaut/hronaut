import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const clientGuidePaths = [
  'codex-browser-mcp',
  'claude-code-browser-mcp',
  'gemini-cli-browser-mcp',
  'cursor-browser-mcp',
  'github-copilot-browser-mcp',
  'opencode-browser-mcp',
  'cline-browser-mcp',
  'kiro-browser-mcp',
  'kilo-code-browser-mcp',
  'jetbrains-junie-browser-mcp',
  'devin-local-browser-mcp',
  'zed-browser-mcp',
  'mistral-vibe-browser-mcp',
  'warp-browser-mcp'
] as const

describe('README discoverability', () => {
  it('links every focused coding-agent setup guide without weakening the local boundary', async () => {
    const readme = await readFile('README.md', 'utf8')

    for (const path of clientGuidePaths) {
      expect(readme).toContain(`https://hronaut.dev/${path}`)
    }
    expect(readme).toMatch(/local Streamable HTTP MCP endpoint/i)
    expect(readme).toContain('http://127.0.0.1:47812/mcp')
  })
})

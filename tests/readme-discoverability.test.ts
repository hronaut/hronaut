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

  it('keeps a short public conversion path and distributable discovery metadata', async () => {
    const [readme, packageSource] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('package.json', 'utf8')
    ])
    const packageJson = JSON.parse(packageSource) as {
      description?: string
      homepage?: string
      bugs?: { url?: string }
      keywords?: string[]
    }

    expect(readme).toContain('## Start in three steps')
    expect(readme).toContain('https://github.com/hronaut/hronaut/releases/latest')
    expect(readme).toContain('https://hronaut.dev/setup')
    expect(readme).toContain('https://hronaut.dev/authenticated-browser-agents')
    expect(readme).toContain('https://hronaut.dev/parallel-agent-browser-workspaces')
    expect(readme).toContain('https://hronaut.dev/coding-agent-localhost-browser')
    expect(readme).toContain('https://hronaut.dev/local-web3-wallets-for-coding-agents')
    expect(readme).toContain('https://hronaut.dev/security')
    expect(readme).toContain('actions/workflows/ci.yml/badge.svg?branch=main')
    expect(readme).toMatch(/source-available/i)

    expect(packageJson.description).toMatch(/visible local Browser MCP/i)
    expect(packageJson.homepage).toBe('https://hronaut.dev')
    expect(packageJson.bugs?.url).toBe('https://github.com/hronaut/hronaut/issues')
    expect(packageJson.keywords).toEqual(expect.arrayContaining([
      'browser-mcp',
      'coding-agents',
      'model-context-protocol',
      'persistent-browser',
      'qa-automation'
    ]))
  })
})

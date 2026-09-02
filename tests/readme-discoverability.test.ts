import { access, readFile } from 'node:fs/promises'
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
    const quickstart = readme.match(/## Start in three steps\n[\s\S]*?(?=\n#{2,3} )/u)?.[0] ?? ''

    expect(readme).toContain('## Start in three steps')
    expect(quickstart).toContain('[Download the latest Hronaut](https://hronaut.dev/download)')
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

  it('keeps every repository-relative documentation link valid', async () => {
    const readme = await readFile('README.md', 'utf8')
    const targets = [...readme.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)]
      .map((match) => match[1]!)
      .filter((target) => !target.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/iu.test(target))
      .map((target) => decodeURIComponent(target.split(/[?#]/u, 1)[0]!))
    const missing: string[] = []

    for (const target of new Set(targets)) {
      try {
        await access(target)
      } catch {
        missing.push(target)
      }
    }

    expect(missing).toEqual([])
  })

  it('gives unsigned-package evaluators a copyable release verification path', async () => {
    const readme = await readFile('README.md', 'utf8')
    const install = readme.match(/## Install\n[\s\S]*?(?=\n## Run from source)/u)?.[0] ?? ''

    expect(install).toContain('### Verify an unsigned download')
    expect(install).toContain('gh release download --repo hronaut/hronaut --pattern hashes.txt')
    expect(install).toContain('gh attestation verify "./PACKAGE_FILENAME" --repo hronaut/hronaut')
    expect(install).toContain('sha256sum "./PACKAGE_FILENAME"')
    expect(install).toContain('shasum -a 256 "./PACKAGE_FILENAME"')
    expect(install).toContain('Get-FileHash .\\PACKAGE_FILENAME -Algorithm SHA256')
    expect(install).toContain('matching filename in `hashes.txt`')
    expect(install).toContain('[release trust guide](https://hronaut.dev/security#verify-release)')
  })
})

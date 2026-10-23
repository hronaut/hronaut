import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_MCP_PORT } from '../src/shared/mcp-port.js'

const run = promisify(execFile)
const HELPER = join(process.cwd(), 'plugins/hronaut/scripts/hronaut-headers.sh')
const STORE_DESCRIPTION = 'Connects your coding agent to Hronaut — a visible desktop browser it can drive over MCP. '
  + 'Watch every step, pause and take over, keep logins between sessions. Requires the Hronaut app (free 10-day trial at hronaut.dev).'
const TOKEN = 'a'.repeat(20) + '-_B9'.repeat(5)

interface PluginManifest {
  name: string
  version: string
  description: string
  icon: string
  mcpServers: Record<string, { type: string; url: string; headers: Record<string, string>; headersHelper: string }>
}

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

describe('the Claude Code plugin in this repository', () => {
  it('is listed in the repository’s marketplace under the store description', async () => {
    const marketplace = await json<{ name: string; owner: { name: string }; plugins: Array<{ name: string; source: string; description: string }> }>(
      '.claude-plugin/marketplace.json'
    )
    // `/plugin marketplace add hronaut/hronaut`, then `/plugin install hronaut@hronaut`.
    expect(marketplace.name).toBe('hronaut')
    expect(marketplace.owner.name).toBe('Hronaut')
    expect(marketplace.plugins).toEqual([expect.objectContaining({ name: 'hronaut', source: './plugins/hronaut', description: STORE_DESCRIPTION })])
    const plugin = await json<PluginManifest>('plugins/hronaut/.claude-plugin/plugin.json')
    expect(plugin.name).toBe('hronaut')
    expect(plugin.description).toBe(STORE_DESCRIPTION)
    expect((await readFile(join('plugins/hronaut', plugin.icon))).subarray(1, 4).toString()).toBe('PNG')
  })

  it('carries the app’s version, so installed plugins update with each release', async () => {
    const plugin = await json<PluginManifest>('plugins/hronaut/.claude-plugin/plugin.json')
    expect(plugin.version).toBe((await json<{ version: string }>('package.json')).version)
  })

  it('connects to the local endpoint with the owner token, from the token file or HRONAUT_MCP_TOKEN', async () => {
    const plugin = await json<PluginManifest>('plugins/hronaut/.claude-plugin/plugin.json')
    expect(plugin.mcpServers).toEqual({
      hronaut: {
        type: 'http',
        url: `http://127.0.0.1:\${HRONAUT_MCP_PORT:-${DEFAULT_MCP_PORT}}/mcp`,
        // Claude Code hides variables named like a token from a headers helper, so the variable is read here.
        headers: { Authorization: 'Bearer ${HRONAUT_MCP_TOKEN:-}' },
        headersHelper: 'sh "${CLAUDE_PLUGIN_ROOT}/scripts/hronaut-headers.sh"'
      }
    })
  })

  it('ships the same Hronaut skill as the repository', async () => {
    // Claude Code copies only the plugin's folder, so the skill is a copy rather than a link to skills/hronaut.
    expect(await readFile('plugins/hronaut/skills/hronaut/SKILL.md', 'utf8')).toBe(await readFile('skills/hronaut/SKILL.md', 'utf8'))
  })
})

// The helper is a POSIX shell script; on Windows Claude Code runs it in Git Bash, which this host does not have.
describe.skipIf(process.platform === 'win32')('the plugin’s headers helper', () => {
  let home: string
  let bin: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'hronaut-plugin-'))
    bin = join(home, 'bin')
    await mkdir(bin)
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  /** Runs the helper as Claude Code does, on a system that reports itself as `system` to `uname`. */
  async function headers(environment: Record<string, string>, system?: string): Promise<unknown> {
    if (system) {
      await writeFile(join(bin, 'uname'), `#!/bin/sh\necho ${system}\n`)
      await writeFile(join(bin, 'cygpath'), `#!/bin/sh\necho "${home}/converted"\n`)
      await Promise.all([chmod(join(bin, 'uname'), 0o755), chmod(join(bin, 'cygpath'), 0o755)])
    }
    const { stdout } = await run('sh', [HELPER], { env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, ...environment } })
    return JSON.parse(stdout)
  }

  async function writeToken(directory: string, content: string): Promise<void> {
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'mcp-token'), content, { mode: 0o600 })
  }

  it('sends the token from the profile Hronaut uses on Linux, macOS and Windows', async () => {
    await writeToken(join(home, '.config', 'Hronaut'), `${TOKEN}\n`)
    expect(await headers({}, 'Linux')).toEqual({ Authorization: `Bearer ${TOKEN}` })

    await writeToken(join(home, 'xdg', 'Hronaut'), `${TOKEN}x\r\n`)
    expect(await headers({ XDG_CONFIG_HOME: join(home, 'xdg') }, 'Linux')).toEqual({ Authorization: `Bearer ${TOKEN}x` })

    await writeToken(join(home, 'Library', 'Application Support', 'Hronaut'), `${TOKEN}m\n`)
    expect(await headers({}, 'Darwin')).toEqual({ Authorization: `Bearer ${TOKEN}m` })

    // Git Bash gives %APPDATA% as a Windows path, which cygpath turns into its own.
    await writeToken(join(home, 'converted', 'Hronaut'), `${TOKEN}w\r\n`)
    expect(await headers({ APPDATA: 'C:\\Users\\person\\AppData\\Roaming' }, 'MINGW64_NT-10.0-26100')).toEqual({ Authorization: `Bearer ${TOKEN}w` })
  })

  it('uses the profile HRONAUT_USER_DATA_DIR names, as Hronaut does', async () => {
    await writeToken(join(home, 'custom'), `${TOKEN}\n`)
    await writeToken(join(home, '.config', 'Hronaut'), `${TOKEN}other\n`)
    expect(await headers({ HRONAUT_USER_DATA_DIR: join(home, 'custom') }, 'Linux')).toEqual({ Authorization: `Bearer ${TOKEN}` })
  })

  it('sends no header of its own without a token file, or for a file that does not hold a Hronaut token', async () => {
    // The plugin's header from HRONAUT_MCP_TOKEN then applies, and Hronaut ignores it while authentication is off.
    expect(await headers({}, 'Linux')).toEqual({})
    for (const content of ['short-token\n', `${TOKEN}"}\n`, `${TOKEN} ${TOKEN}\n`, '']) {
      await writeToken(join(home, '.config', 'Hronaut'), content)
      expect(await headers({}, 'Linux')).toEqual({})
    }
  })
})

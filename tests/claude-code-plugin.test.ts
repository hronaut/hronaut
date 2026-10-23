import { exec, execFile, spawnSync } from 'node:child_process'
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_MCP_PORT } from '../src/shared/mcp-port.js'

const run = promisify(execFile)
const runCommand = promisify(exec)
const PLUGIN_ROOT = join(process.cwd(), 'plugins/hronaut')
const HELPER = join(PLUGIN_ROOT, 'scripts/hronaut-headers.sh')
const HEADERS_HELPER = 'sh "${CLAUDE_PLUGIN_ROOT}/scripts/hronaut-headers.sh" || "${CLAUDE_PLUGIN_ROOT}/scripts/hronaut-headers.cmd"'
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

  it('carries the app’s version, so installed plugins update with each release, and its license', async () => {
    const plugin = await json<PluginManifest>('plugins/hronaut/.claude-plugin/plugin.json')
    expect(plugin.version).toBe((await json<{ version: string }>('package.json')).version)
    // Claude Code installs only the plugin's folder, so the license it names is a copy there.
    expect(await readFile('plugins/hronaut/LICENSE', 'utf8')).toBe(await readFile('LICENSE', 'utf8'))
  })

  // The production workflow runs Bash on Ubuntu.
  it.skipIf(process.platform === 'win32')('stops the release tag when the bump left the plugin on another version', async () => {
    const workflow = await readFile('.github/workflows/auto-tag.yml', 'utf8')
    const step = workflow.split('      - name: Check that the plugins carry the version\n')[1]?.split('\n      - name:')[0]
    const script = step?.split('        run: |\n')[1]?.split('\n').map((line) => line.replace(/^ {10}/, '')).join('\n')
    if (!script) throw new Error('The plugin version check was not found')
    expect(workflow.indexOf('Check that the plugins carry the version')).toBeLessThan(workflow.indexOf('git tag -a "$TAG"'))
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-plugin-version-'))
    try {
      await cp('plugins/hronaut/.claude-plugin', join(directory, 'plugins/hronaut/.claude-plugin'), { recursive: true })
      await cp('extensions/vscode/package.json', join(directory, 'extensions/vscode/package.json'))
      const version = (await json<PluginManifest>('plugins/hronaut/.claude-plugin/plugin.json')).version
      const check = (VERSION: string) => spawnSync('bash', ['-c', script], { cwd: directory, encoding: 'utf8', env: { PATH: process.env.PATH, VERSION } })
      expect(check(version).status).toBe(0)
      const missed = check('99.0.0')
      expect(missed.status).toBe(1)
      expect(missed.stderr).toContain(`plugins/hronaut/.claude-plugin/plugin.json names version ${version}; the release bump must set it to 99.0.0 too.`)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('connects to the local endpoint with the owner token, from the token file or HRONAUT_MCP_TOKEN', async () => {
    const plugin = await json<PluginManifest>('plugins/hronaut/.claude-plugin/plugin.json')
    expect(plugin.mcpServers).toEqual({
      hronaut: {
        type: 'http',
        url: `http://127.0.0.1:\${HRONAUT_MCP_PORT:-${DEFAULT_MCP_PORT}}/mcp`,
        // Claude Code hides variables named like a token from a headers helper, so the variable is read here.
        headers: { Authorization: 'Bearer ${HRONAUT_MCP_TOKEN:-}' },
        // Claude Code runs it with the system shell, so on Windows cmd.exe runs the .cmd when sh is not on the PATH.
        headersHelper: HEADERS_HELPER
      }
    })
  })

  it('accepts only the tokens Hronaut writes, in each of its headers helpers', async () => {
    expect(await readFile('src/main/mcp-token-store.ts', 'utf8')).toContain('const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,}$/')
    const shell = await readFile('plugins/hronaut/scripts/hronaut-headers.sh', 'utf8')
    expect(shell).toContain("'' | *[!A-Za-z0-9_-]*) printf '{}\\n' ;;")
    expect(shell).toContain('if [ "${#token}" -ge 32 ]; then')
    expect(await readFile('plugins/hronaut/scripts/hronaut-headers.ps1', 'utf8')).toContain("$token -cmatch '^[A-Za-z0-9_-]{32,}\\z'")
    expect(await readFile('plugins/hronaut/scripts/hronaut-headers.cmd', 'utf8')).toContain('-File "%~dp0hronaut-headers.ps1"')
  })

  it('keeps its helpers runnable when Git for Windows checks them out', async () => {
    // Git for Windows turns line endings into CRLF by default, which sh can't run.
    expect(await readFile('.gitattributes', 'utf8')).toContain('plugins/hronaut/scripts/*.sh text eol=lf')
  })

  it('ships the same Hronaut skill as the repository', async () => {
    // Claude Code copies only the plugin's folder, so the skill is a copy rather than a link to skills/hronaut.
    expect(await readFile('plugins/hronaut/skills/hronaut/SKILL.md', 'utf8')).toBe(await readFile('skills/hronaut/SKILL.md', 'utf8'))
  })
})

/** The plugin's headersHelper command as Claude Code runs it, with the plugin's folder put in. */
function headersHelperCommand(): string {
  return HEADERS_HELPER.replaceAll('${CLAUDE_PLUGIN_ROOT}', PLUGIN_ROOT)
}

async function writeToken(directory: string, content: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'mcp-token'), content, { mode: 0o600 })
}

// The helper is a POSIX shell script; on Windows the .cmd runs instead unless sh is on the PATH, tested below.
describe.skipIf(process.platform === 'win32')('the plugin’s headers helper', () => {
  let home: string
  let bin: string
  let folder: string

  beforeEach(async () => {
    // Electron names the profile folder after the packaged app's productName, or its name, which is lowercase.
    const app = await json<{ name: string; productName?: string }>('package.json')
    folder = app.productName ?? app.name
    home = await mkdtemp(join(tmpdir(), 'hronaut-plugin-'))
    bin = join(home, 'bin')
    await mkdir(bin)
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  /** Runs the helper as Claude Code does, on a system that reports itself as `system` to `uname`. */
  async function headers(environment: Record<string, string>, system?: string, { withHome = true } = {}): Promise<unknown> {
    if (system) {
      await writeFile(join(bin, 'uname'), `#!/bin/sh\necho ${system}\n`)
      await chmod(join(bin, 'uname'), 0o755)
    }
    const { stdout, stderr } = await run('sh', [HELPER], { env: { PATH: `${bin}:/usr/bin:/bin`, ...(withHome ? { HOME: home } : {}), ...environment } })
    // Claude Code takes the helper's output as the headers, so it prints nothing else and never fails.
    expect(stderr).toBe('')
    return JSON.parse(stdout)
  }

  /** A `cygpath` that turns the one Windows path the tests use into a folder of this test. */
  async function fakeCygpath(): Promise<void> {
    await writeFile(join(bin, 'cygpath'), `#!/bin/sh\n[ "$1" = -u ] && [ "$2" = 'C:\\Users\\person\\AppData\\Roaming' ] && echo "${home}/converted"\n`)
    await chmod(join(bin, 'cygpath'), 0o755)
  }

  it('sends the token from the profile Hronaut uses on Linux, macOS and Windows', async () => {
    await writeToken(join(home, '.config', folder), `${TOKEN}\n`)
    expect(await headers({}, 'Linux')).toEqual({ Authorization: `Bearer ${TOKEN}` })

    await writeToken(join(home, 'xdg', folder), `${TOKEN}x\r\n`)
    expect(await headers({ XDG_CONFIG_HOME: join(home, 'xdg') }, 'Linux')).toEqual({ Authorization: `Bearer ${TOKEN}x` })

    await writeToken(join(home, 'Library', 'Application Support', folder), `${TOKEN}m\n`)
    expect(await headers({}, 'Darwin')).toEqual({ Authorization: `Bearer ${TOKEN}m` })

    // Git Bash gives %APPDATA% as a Windows path, which cygpath turns into its own.
    await fakeCygpath()
    await writeToken(join(home, 'converted', folder), `${TOKEN}w\r\n`)
    const appData = { APPDATA: 'C:\\Users\\person\\AppData\\Roaming' }
    for (const system of ['MINGW64_NT-10.0-26100', 'MSYS_NT-10.0-26100', 'UCRT64_NT-10.0-26100', 'CLANGARM64_NT-10.0-26100', 'CYGWIN_NT-10.0-26100']) {
      expect(await headers(appData, system)).toEqual({ Authorization: `Bearer ${TOKEN}w` })
    }
  })

  it('takes %APPDATA% as it is where there is no cygpath', async () => {
    await writeToken(join(home, 'roaming', folder), `${TOKEN}\n`)
    expect(await headers({ APPDATA: join(home, 'roaming') }, 'MINGW64_NT-10.0-26100')).toEqual({ Authorization: `Bearer ${TOKEN}` })
  })

  it('uses the profile HRONAUT_USER_DATA_DIR names, as Hronaut does', async () => {
    await writeToken(join(home, 'custom'), `${TOKEN}\n`)
    await writeToken(join(home, '.config', folder), `${TOKEN}other\n`)
    expect(await headers({ HRONAUT_USER_DATA_DIR: join(home, 'custom') }, 'Linux')).toEqual({ Authorization: `Bearer ${TOKEN}` })
  })

  it('reads the token file as Hronaut does, trimming it', async () => {
    await writeToken(join(home, '.config', folder), `\uFEFF ${TOKEN}\t \r\n\n`)
    expect(await headers({}, 'Linux')).toEqual({ Authorization: `Bearer ${TOKEN}` })
  })

  it('sends no header of its own without a token file, or for a file that does not hold a Hronaut token', async () => {
    // The plugin's header from HRONAUT_MCP_TOKEN then applies, and Hronaut ignores it while authentication is off.
    expect(await headers({}, 'Linux')).toEqual({})
    expect(await headers({}, 'Linux', { withHome: false })).toEqual({})
    for (const content of ['short-token\n', `${TOKEN}"}\n`, `${TOKEN} ${TOKEN}\n`, `${TOKEN}\n${TOKEN}\n`, '']) {
      await writeToken(join(home, '.config', folder), content)
      expect(await headers({}, 'Linux')).toEqual({})
    }
  })

  it('sends the token only to a numbered port on this computer', async () => {
    await writeToken(join(home, '.config', folder), `${TOKEN}\n`)
    expect(await headers({ HRONAUT_MCP_PORT: '48000' }, 'Linux')).toEqual({ Authorization: `Bearer ${TOKEN}` })
    // Claude Code puts the variable into the address as it is, so these would send the header to another host or port 80.
    for (const port of ['1@attacker.example:8080', '48000/x', '']) {
      expect(await headers({ HRONAUT_MCP_PORT: port }, 'Linux')).toEqual({})
    }
  })

  it('is what the plugin’s command runs on macOS and Linux', async () => {
    // This runs the system's own uname, so the profile is named rather than found.
    await writeToken(join(home, 'profile'), `${TOKEN}\n`)
    const environment = { PATH: '/usr/bin:/bin', HOME: home, HRONAUT_USER_DATA_DIR: join(home, 'profile') }
    const { stdout, stderr } = await runCommand(headersHelperCommand(), { shell: '/bin/sh', env: environment })
    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toEqual({ Authorization: `Bearer ${TOKEN}` })
  })
})

// Claude Code runs the command with cmd.exe on Windows, where sh is on the PATH only for some installs of Git.
describe.runIf(process.platform === 'win32')('the plugin’s headers helper on Windows', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'hronaut-plugin-'))
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  /** The PATH of a terminal where Git for Windows put only its `cmd` folder on the PATH, as by default. */
  function pathWithoutSh(): string {
    return (process.env.Path ?? process.env.PATH ?? '').split(';').filter((entry) => !/\\(usr\\)?bin\\?$/i.test(entry) || !/git|msys/i.test(entry)).join(';')
  }

  async function headers(environment: Record<string, string>): Promise<unknown> {
    const env: Record<string, string | undefined> = { ...process.env, Path: pathWithoutSh(), ...environment }
    delete env.PATH
    const { stdout } = await runCommand(headersHelperCommand(), { env, timeout: 30_000 })
    return JSON.parse(stdout)
  }

  it('sends the token from the profile without sh on the PATH', async () => {
    await writeToken(join(home, 'profile'), `\uFEFF${TOKEN}\r\n`)
    expect(await headers({ HRONAUT_USER_DATA_DIR: join(home, 'profile') })).toEqual({ Authorization: `Bearer ${TOKEN}` })
    expect(await headers({ HRONAUT_USER_DATA_DIR: join(home, 'profile'), HRONAUT_MCP_PORT: '48000' })).toEqual({ Authorization: `Bearer ${TOKEN}` })
  })

  it('sends no header for a missing or malformed token, or a port that is not a number', async () => {
    expect(await headers({ HRONAUT_USER_DATA_DIR: join(home, 'missing') })).toEqual({})
    await writeToken(join(home, 'profile'), `${TOKEN}"}\r\n`)
    expect(await headers({ HRONAUT_USER_DATA_DIR: join(home, 'profile') })).toEqual({})
    await writeToken(join(home, 'profile'), `${TOKEN}\r\n`)
    expect(await headers({ HRONAUT_USER_DATA_DIR: join(home, 'profile'), HRONAUT_MCP_PORT: '1@attacker.example:8080' })).toEqual({})
  })
})

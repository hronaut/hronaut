import { chmod, link, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ClaudeCodeSetup, claudeCodeConfigPath, claudeCodeSetupStatus } from '../src/main/claude-code-setup.js'
import { claudeCodeSetupErrorCode } from '../src/shared/claude-code-setup.js'
import { detectAgentClients } from '../src/main/agent-client-detection.js'

const endpoint = 'http://127.0.0.1:47812/mcp'
const TOKEN = 'setup-test-token-7f3a'
let directory: string
let path: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hronaut-claude-setup-'))
  path = join(directory, '.claude.json')
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

const settings = (value: unknown, indent = 2): string => JSON.stringify(value, null, indent)
const setup = (confirm: Mock<(preview: unknown, signal?: AbortSignal) => Promise<boolean>> = vi.fn(async () => true), now = () => Date.UTC(2026, 9, 17, 7, 30, 0), token?: string) =>
  ({ confirm, service: new ClaudeCodeSetup({ path, endpoint: () => endpoint, credential: () => token === undefined ? undefined : { token }, confirm, now, platform: 'linux' }) })
const code = async (promise: Promise<unknown>) => claudeCodeSetupErrorCode(await promise.then(() => null, (error: unknown) => error))

describe('Claude Code setup', () => {
  it('finds the settings file under CLAUDE_CONFIG_DIR, or in the home folder', () => {
    expect(claudeCodeConfigPath({ CLAUDE_CONFIG_DIR: '/custom' }, '/home/me')).toBe(join('/custom', '.claude.json'))
    expect(claudeCodeConfigPath({ CLAUDE_CONFIG_DIR: '  ' }, '/home/me')).toBe(join('/home/me', '.claude.json'))
  })

  it('reads a relative CLAUDE_CONFIG_DIR as not found instead of guessing where Claude Code starts', async () => {
    const relative = claudeCodeConfigPath({ CLAUDE_CONFIG_DIR: 'claude' }, directory)
    expect(relative).toBe(join('claude', '.claude.json'))
    expect((await claudeCodeSetupStatus(relative, endpoint, undefined)).state).toBe('not-found')
  })

  it('reports each state without changing the file', async () => {
    expect((await claudeCodeSetupStatus(path, endpoint, undefined)).state).toBe('not-found')
    await writeFile(path, settings({ numStartups: 3 }))
    expect((await claudeCodeSetupStatus(path, endpoint, undefined)).state).toBe('not-configured')
    await writeFile(path, settings({ mcpServers: { hronaut: { type: 'http', url: endpoint } } }))
    expect((await claudeCodeSetupStatus(path, endpoint, undefined)).state).toBe('configured')
    await writeFile(path, settings({ mcpServers: { hronaut: { type: 'http', url: 'http://127.0.0.1:1/mcp' } } }))
    expect((await claudeCodeSetupStatus(path, endpoint, undefined)).state).toBe('other-address')
    for (const text of ['{"a":1, "a":2}', '{ "a": 1 }', '[]', '{\n  "mcpServers": []\n}', '﻿{}', '{\r\n  "a": 1\r\n}', 'not json']) {
      await writeFile(path, text)
      expect((await claudeCodeSetupStatus(path, endpoint, undefined)).state, text).toBe('unreadable')
    }
  })

  it('shows the exact change, asks, backs up the file and changes only its own entry', async () => {
    const original = `${settings({ numStartups: 3, mcpServers: { other: { type: 'stdio', command: 'x' } }, projects: { '/a': { allowedTools: [] } } })}\n`
    await writeFile(path, original, { mode: 0o640 })
    const { service, confirm } = setup()
    const preview = await service.prepare(7)
    expect(preview).toMatchObject({ path, before: null, after: settings({ type: 'http', url: endpoint }), backupName: '.claude.json.hronaut-backup-20261017T073000Z' })
    expect(await readFile(path, 'utf8')).toBe(original)

    expect(await service.apply(preview.planId, 7)).toEqual({ outcome: 'applied', backupName: preview.backupName })
    expect(confirm).toHaveBeenCalledWith(preview, undefined)
    expect(await readFile(join(directory, preview.backupName), 'utf8')).toBe(original)
    expect((await stat(join(directory, preview.backupName))).mode & 0o777).toBe(0o600)
    const written = await readFile(path, 'utf8')
    expect(written).toBe(`${settings({ numStartups: 3, mcpServers: { other: { type: 'stdio', command: 'x' }, hronaut: { type: 'http', url: endpoint } }, projects: { '/a': { allowedTools: [] } } })}\n`)
    expect((await stat(path)).mode & 0o777).toBe(0o640)
  })

  it('keeps the file’s indentation and an old entry’s place when it updates the address', async () => {
    await writeFile(path, settings({ mcpServers: { hronaut: { type: 'http', url: 'http://127.0.0.1:1/mcp' }, other: {} } }, 4))
    const { service } = setup()
    const preview = await service.prepare(1)
    expect(preview.before).toBe(settings({ type: 'http', url: 'http://127.0.0.1:1/mcp' }))
    await service.apply(preview.planId, 1)
    expect(await readFile(path, 'utf8')).toBe(settings({ mcpServers: { hronaut: { type: 'http', url: endpoint }, other: {} } }, 4))
  })

  it('writes nothing when the person cancels, and each plan works once for the page that asked', async () => {
    await writeFile(path, settings({}))
    const { service } = setup(vi.fn(async () => false))
    const preview = await service.prepare(1)
    expect(await service.apply(preview.planId, 1)).toEqual({ outcome: 'cancelled' })
    expect(await readFile(path, 'utf8')).toBe(settings({}))
    expect(await readdir(directory)).toEqual(['.claude.json'])
    expect(await code(service.apply(preview.planId, 1))).toBe('expired')
    const other = await service.prepare(1)
    expect(await code(service.apply(other.planId, 2))).toBe('expired')
    expect(await code(service.apply(42, 1))).toBe('expired')
  })

  it('refuses a plan after the file changed, after two minutes, or after another prepare from the same page', async () => {
    await writeFile(path, settings({}))
    let now = 0
    const confirm = vi.fn(async () => true)
    const service = new ClaudeCodeSetup({ path, endpoint: () => endpoint, confirm, now: () => now })
    const changed = await service.prepare(1)
    await writeFile(path, settings({ numStartups: 4 }))
    expect(await code(service.apply(changed.planId, 1))).toBe('changed')
    const late = await service.prepare(1)
    now += 2 * 60_000
    expect(await code(service.apply(late.planId, 1))).toBe('expired')
    const first = await service.prepare(1)
    const second = await service.prepare(1)
    expect(await code(service.apply(first.planId, 1))).toBe('expired')
    expect((await service.apply(second.planId, 1)).outcome).toBe('applied')
  })

  it('refuses when already set up, and when the file is missing or not safe to rewrite', async () => {
    const { service } = setup()
    expect(await code(service.prepare(1))).toBe('not-found')
    await writeFile(path, '{"a": 1}')
    expect(await code(service.prepare(1))).toBe('unreadable')
    await writeFile(path, settings({ mcpServers: { hronaut: { type: 'http', url: endpoint } } }))
    expect(await code(service.prepare(1))).toBe('configured')
  })

  it('changes the file a symlink points to and keeps the link', async () => {
    const real = join(directory, 'real.json')
    await writeFile(real, settings({}))
    await symlink(real, path)
    const { service } = setup()
    const preview = await service.prepare(1)
    await service.apply(preview.planId, 1)
    expect((await readFile(real, 'utf8'))).toContain('"hronaut"')
    expect(await readdir(directory)).toEqual(expect.arrayContaining(['.claude.json', 'real.json', 'real.json.hronaut-backup-20261017T073000Z']))
  })

  it('leaves alone a file that is not valid UTF-8, another account’s or linked elsewhere', async () => {
    await writeFile(path, Buffer.concat([Buffer.from('{\n  "projects": {\n    "/home/caf'), Buffer.from([0xe9]), Buffer.from('": {}\n  }\n}')]))
    expect((await claudeCodeSetupStatus(path, endpoint, undefined)).state).toBe('unreadable')
    await writeFile(path, settings({}))
    await link(path, join(directory, 'other.json'))
    expect((await claudeCodeSetupStatus(path, endpoint, undefined)).state).toBe('unreadable')
    await rm(join(directory, 'other.json'))
    expect((await claudeCodeSetupStatus(path, endpoint, undefined)).state).toBe('not-configured')
    await chmod(path, 0o444)
    expect((await claudeCodeSetupStatus(path, endpoint, undefined, 'win32')).state).toBe('unreadable')
  })

  it('keeps the exact bytes in the backup and the exact mode whatever the umask', async () => {
    const original = Buffer.from(`${settings({ name: 'Zoë 🚀', mcpServers: {} })}\n`, 'utf8')
    await writeFile(path, original)
    await chmod(path, 0o664)
    const previous = process.umask(0o022)
    try {
      const { service } = setup()
      const preview = await service.prepare(1)
      await service.apply(preview.planId, 1)
      expect((await readFile(join(directory, preview.backupName))).equals(original)).toBe(true)
      expect((await stat(path)).mode & 0o777).toBe(0o664)
    } finally { process.umask(previous) }
  })

  it('shows an old entry’s type and address only, never header, environment or query values', async () => {
    await writeFile(path, settings({ mcpServers: { hronaut: { type: 'http', url: 'http://me:secret@127.0.0.1:1/mcp?token=abc', headers: { Authorization: 'Bearer abc' }, env: { KEY: 'abc' }, args: ['--token', 'abc'] } } }))
    const preview = await setup().service.prepare(1)
    expect(preview.before).not.toContain('abc')
    expect(preview.before).not.toContain('secret')
    expect(JSON.parse(preview.before!)).toEqual({ type: 'http', url: 'http://•••@127.0.0.1:1/mcp?•••', headers: { Authorization: '•••' }, env: { KEY: '•••' }, args: '•••' })
  })

  it('never shows a token an old entry carries in its address, in any part of it or any kind of address', async () => {
    const shown = new Map([
      ['http://127.0.0.1:1/mcp#abc', 'http://127.0.0.1:1/mcp?•••'],
      ['http://127.0.0.1:1/mcp/abc', 'http://127.0.0.1:1/•••'],
      ['https://abc@example.test/', 'https://•••@example.test/'],
      ['ws://127.0.0.1:1/mcp?key=abc#abc', 'ws://127.0.0.1:1/mcp?•••'],
      ['data:text/plain,abc', '•••'],
      ['javascript:abc', '•••'],
      ['file:///home/abc/mcp', '•••'],
      ['abc', '•••']
    ])
    for (const [url, expected] of shown) {
      await writeFile(path, settings({ mcpServers: { hronaut: { type: 'abc', url } } }))
      const preview = await setup().service.prepare(1)
      expect(preview.before, url).not.toContain('abc')
      expect(JSON.parse(preview.before!), url).toEqual({ type: '•••', url: expected })
    }
  })

  it('cuts a long old entry short without splitting a character in two', async () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    let crossed = false
    // Header names that put a character written as two UTF-16 units on each side of the preview's limit.
    for (let length = 1_915; length <= 1_925; length += 1) {
      const name = `${'a'.repeat(length)}😀😀`
      const full = settings({ type: 'http', url: 'http://127.0.0.1:1/mcp', headers: { [name]: '•••' } })
      crossed ||= /[\uD800-\uDBFF]/.test(full.charAt(1_999))
      await writeFile(path, settings({ mcpServers: { hronaut: { type: 'http', url: 'http://127.0.0.1:1/mcp', headers: { [name]: 'x' } } } }))
      const before = (await setup().service.prepare(1)).before!
      expect(before.endsWith('…'), String(length)).toBe(true)
      expect(before.length, String(length)).toBeLessThanOrEqual(2_001)
      expect(before, String(length)).not.toMatch(lone)
      expect(full.startsWith(before.slice(0, -1)), String(length)).toBe(true)
    }
    expect(crossed).toBe(true)
  })

  it('writes nothing when the page that asked goes away while the dialog asks, even after a yes', async () => {
    await writeFile(path, settings({}))
    const closed = new AbortController()
    const { service, confirm } = setup(vi.fn(async (_preview: unknown, signal?: AbortSignal) => {
      expect(signal).toBe(closed.signal)
      closed.abort()
      return true
    }))
    const preview = await service.prepare(1)
    expect(await service.apply(preview.planId, 1, closed.signal)).toEqual({ outcome: 'cancelled' })
    expect(confirm).toHaveBeenCalledOnce()
    expect(await readFile(path, 'utf8')).toBe(settings({}))
    expect(await readdir(directory)).toEqual(['.claude.json'])
  })

  it('changes nothing when the address, authentication, the token or the file changes while the dialog is open', async () => {
    await writeFile(path, settings({}))
    let address = endpoint
    let token: string | undefined = TOKEN
    let during = async () => {}
    let allowed = true
    const service = new ClaudeCodeSetup({ path, endpoint: () => address, credential: () => token === undefined ? undefined : { token }, allowed: () => allowed, confirm: async () => { await during(); return true }, now: () => Date.UTC(2026, 9, 17, 7, 30, 0) })
    during = async () => { address = 'http://127.0.0.1:1/mcp' }
    expect(await code(service.apply((await service.prepare(1)).planId, 1))).toBe('expired')
    address = endpoint
    during = async () => { token = undefined }
    expect(await code(service.apply((await service.prepare(1)).planId, 1))).toBe('expired')
    during = async () => { token = TOKEN }
    expect(await code(service.apply((await service.prepare(1)).planId, 1))).toBe('expired')
    during = async () => { token = 'regenerated-token' }
    expect(await code(service.apply((await service.prepare(1)).planId, 1))).toBe('expired')
    token = TOKEN
    during = async () => { allowed = false }
    expect(await code(service.apply((await service.prepare(1)).planId, 1))).toBe('expired')
    allowed = true
    token = TOKEN
    during = async () => { await writeFile(path, settings({ numStartups: 2 })) }
    expect(await code(service.apply((await service.prepare(1)).planId, 1))).toBe('changed')
    expect(await readFile(path, 'utf8')).toBe(settings({ numStartups: 2 }))
    expect(await readdir(directory)).toEqual(['.claude.json'])
  })

  it('with authentication on, writes the token header but shows and passes on only •••', async () => {
    const original = `${settings({ numStartups: 3, mcpServers: { other: { type: 'stdio', command: 'x' } } })}\n`
    await writeFile(path, original, { mode: 0o644 })
    const { service, confirm } = setup(undefined, undefined, TOKEN)
    const preview = await service.prepare(7)
    expect(preview).toMatchObject({ before: null, tokenHidden: true, after: settings({ type: 'http', url: endpoint, headers: { Authorization: 'Bearer •••' } }) })
    expect(JSON.stringify(preview)).not.toContain(TOKEN)

    expect(await service.apply(preview.planId, 7)).toEqual({ outcome: 'applied', backupName: preview.backupName })
    expect(JSON.stringify(confirm.mock.calls)).not.toContain(TOKEN)
    expect(await readFile(path, 'utf8')).toBe(`${settings({ numStartups: 3, mcpServers: { other: { type: 'stdio', command: 'x' }, hronaut: { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${TOKEN}` } } } })}\n`)
    // The file now holds the token, so other accounts lose access to it; the backup holds no token and is private anyway.
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await readFile(join(directory, preview.backupName), 'utf8')).toBe(original)
    expect((await claudeCodeSetupStatus(path, endpoint, { token: TOKEN })).state).toBe('configured')
    expect(await code(service.prepare(7))).toBe('configured')
  })

  it('offers to update an entry that does not send the current token, and keeps one without a token while authentication is off', async () => {
    const entry = (headers?: Record<string, string>) => settings({ mcpServers: { hronaut: { type: 'http', url: endpoint, ...(headers && { headers }) } } })
    await writeFile(path, entry())
    expect((await claudeCodeSetupStatus(path, endpoint, { token: TOKEN })).state).toBe('other-token')
    expect((await claudeCodeSetupStatus(path, endpoint, undefined)).state).toBe('configured')
    await writeFile(path, entry({ Authorization: 'Bearer old-token' }))
    expect((await claudeCodeSetupStatus(path, endpoint, { token: TOKEN })).state).toBe('other-token')
    // While authentication is off Hronaut ignores the header, so the entry still connects.
    expect((await claudeCodeSetupStatus(path, endpoint, undefined)).state).toBe('configured')
    // The listener reads the header and its scheme without regard to case, and takes a capability profile's credential.
    await writeFile(path, entry({ authorization: `bearer  ${TOKEN}` }))
    expect((await claudeCodeSetupStatus(path, endpoint, { token: TOKEN })).state).toBe('configured')
    await writeFile(path, entry({ Authorization: 'Bearer hronaut_profile_credential' }))
    expect((await claudeCodeSetupStatus(path, endpoint, { token: TOKEN, accepts: bearer => bearer === 'hronaut_profile_credential' })).state).toBe('configured')
    expect((await claudeCodeSetupStatus(path, endpoint, { token: TOKEN, accepts: () => false })).state).toBe('other-token')
    await writeFile(path, entry({ Authorization: TOKEN }))
    expect((await claudeCodeSetupStatus(path, endpoint, { token: TOKEN })).state).toBe('other-token')
    await writeFile(path, settings({ mcpServers: { hronaut: { type: 'http', url: 'http://127.0.0.1:1/mcp', headers: { Authorization: `Bearer ${TOKEN}` } } } }))
    expect((await claudeCodeSetupStatus(path, endpoint, { token: TOKEN })).state).toBe('other-address')

    await writeFile(path, entry({ Authorization: 'Bearer old-token' }))
    const { service } = setup(undefined, undefined, TOKEN)
    const preview = await service.prepare(1)
    expect(preview.before).toBe(settings({ type: 'http', url: endpoint, headers: { Authorization: '•••' } }))
    await service.apply(preview.planId, 1)
    expect(await readFile(path, 'utf8')).toBe(entry({ Authorization: `Bearer ${TOKEN}` }))
  })

  it('keeps the exact mode of a file it writes with the token on Windows', async () => {
    await writeFile(path, settings({}))
    await chmod(path, 0o644)
    const windows = new ClaudeCodeSetup({ path, endpoint: () => endpoint, credential: () => ({ token: TOKEN }), confirm: async () => true, platform: 'win32' })
    // On Windows the write bit is all a mode says; Hronaut leaves the file's access to its folder.
    const preview = await windows.prepare(1)
    await windows.apply(preview.planId, 1)
    expect((await stat(path)).mode & 0o777).toBe(0o644)
  })

  it('writes nothing when authentication changes during the writes, just before the file is replaced', async () => {
    const original = settings({ numStartups: 1 })
    await writeFile(path, original)
    // Asked before the dialog, after it, and once more just before the file is replaced.
    const answers = [true, true, false]
    const service = new ClaudeCodeSetup({ path, endpoint: () => endpoint, credential: () => ({ token: TOKEN }), allowed: () => answers.shift() ?? false, confirm: async () => true, platform: 'linux' })
    expect(await code(service.apply((await service.prepare(1)).planId, 1))).toBe('expired')
    expect(answers).toEqual([])
    expect(await readFile(path, 'utf8')).toBe(original)
    expect(await readdir(directory)).toEqual(['.claude.json'])
  })

  it('names the backup so it never collides with one from the same second', async () => {
    await writeFile(path, settings({}))
    await writeFile(join(directory, '.claude.json.hronaut-backup-20261017T073000Z'), 'older')
    const { service } = setup()
    const preview = await service.prepare(1)
    expect(preview.backupName).toBe('.claude.json.hronaut-backup-20261017T073000Z-2')
    expect(await service.apply(preview.planId, 1)).toEqual({ outcome: 'applied', backupName: preview.backupName })
    expect(await readFile(join(directory, '.claude.json.hronaut-backup-20261017T073000Z'), 'utf8')).toBe('older')
  })

  it('finds agents by their usual folders and files only, in the guides’ order', async () => {
    await mkdir(join(directory, '.qwen'))
    await mkdir(join(directory, '.codeium', 'windsurf'), { recursive: true })
    await writeFile(join(directory, '.claude.json'), '{}')
    await mkdir(join(directory, '.codex'))
    expect(await detectAgentClients(directory)).toEqual(['codex', 'claude-code', 'windsurf', 'qwen-code'])
    expect(await detectAgentClients(join(directory, 'missing'), { 'claude-code': [path] })).toEqual(['claude-code'])
  })
})

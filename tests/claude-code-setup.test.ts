import { mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeCodeSetup, claudeCodeConfigPath, claudeCodeSetupStatus } from '../src/main/claude-code-setup.js'
import { claudeCodeSetupErrorCode } from '../src/shared/claude-code-setup.js'

const endpoint = 'http://127.0.0.1:47812/mcp'
let directory: string
let path: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hronaut-claude-setup-'))
  path = join(directory, '.claude.json')
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

const settings = (value: unknown, indent = 2): string => JSON.stringify(value, null, indent)
const setup = (confirm = vi.fn(async () => true), now = () => Date.UTC(2026, 9, 17, 7, 30, 0)) =>
  ({ confirm, service: new ClaudeCodeSetup({ path, endpoint: () => endpoint, confirm, now, platform: 'linux' }) })
const code = async (promise: Promise<unknown>) => claudeCodeSetupErrorCode(await promise.then(() => null, (error: unknown) => error))

describe('Claude Code setup', () => {
  it('finds the settings file under CLAUDE_CONFIG_DIR, or in the home folder', () => {
    expect(claudeCodeConfigPath({ CLAUDE_CONFIG_DIR: '/custom' }, '/home/me')).toBe(join('/custom', '.claude.json'))
    expect(claudeCodeConfigPath({ CLAUDE_CONFIG_DIR: '  ' }, '/home/me')).toBe(join('/home/me', '.claude.json'))
  })

  it('reports each state without changing the file', async () => {
    expect((await claudeCodeSetupStatus(path, endpoint)).state).toBe('not-found')
    await writeFile(path, settings({ numStartups: 3 }))
    expect((await claudeCodeSetupStatus(path, endpoint)).state).toBe('not-configured')
    await writeFile(path, settings({ mcpServers: { hronaut: { type: 'http', url: endpoint } } }))
    expect((await claudeCodeSetupStatus(path, endpoint)).state).toBe('configured')
    await writeFile(path, settings({ mcpServers: { hronaut: { type: 'http', url: 'http://127.0.0.1:1/mcp' } } }))
    expect((await claudeCodeSetupStatus(path, endpoint)).state).toBe('other-address')
    for (const text of ['{"a":1, "a":2}', '{ "a": 1 }', '[]', '{\n  "mcpServers": []\n}', '﻿{}', '{\r\n  "a": 1\r\n}', 'not json']) {
      await writeFile(path, text)
      expect((await claudeCodeSetupStatus(path, endpoint)).state, text).toBe('unreadable')
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
    expect(confirm).toHaveBeenCalledWith(preview)
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
})

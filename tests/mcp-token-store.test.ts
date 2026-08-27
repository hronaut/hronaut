import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadMcpToken } from '../src/main/mcp-token-store.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('loadMcpToken', () => {
  it('creates and reuses an owner-only profile token', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-token-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'mcp-token')
    const created = await loadMcpToken(path)
    const loaded = await loadMcpToken(path)

    expect(created).toEqual(loaded)
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect((await readFile(path, 'utf8')).trim()).toBe(created.token)
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('accepts only strong URL-safe environment tokens', async () => {
    const token = 'abcdefghijklmnopqrstuvwxyz_ABCDEFG-1234567890'
    await expect(loadMcpToken('/unused', token)).resolves.toEqual({ token, source: 'environment' })
    await expect(loadMcpToken('/unused', 'short')).rejects.toThrow('at least 32')
  })

  it('converges concurrent first loads on one atomically created profile token', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-token-race-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'profile', 'mcp-token')

    const loaded = await Promise.all(Array.from({ length: 20 }, () => loadMcpToken(path)))

    expect(new Set(loaded.map(({ token }) => token))).toHaveProperty('size', 1)
    expect(loaded.every(({ source, tokenPath }) => source === 'profile' && tokenPath === path)).toBe(true)
    expect((await readFile(path, 'utf8')).trim()).toBe(loaded[0]!.token)
    expect(await readdir(join(directory, 'profile'))).toEqual(['mcp-token'])
  })
})

import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadMcpToken } from '../src/main/mcp-token-store.js'

describe('loadMcpToken', () => {
  it('creates and reuses an owner-only profile token', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-token-'))
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
})

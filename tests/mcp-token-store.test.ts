import { mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadMcpToken } from '../src/main/mcp-token-store.js'

vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, open: vi.fn(fs.open) }
})
const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.mocked(open).mockReset().mockImplementation(actualFs.open)
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

  it('coalesces concurrent repair of a malformed profile token instead of preventing startup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-token-corrupt-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'mcp-token')
    await writeFile(path, 'truncated-token\n', 'utf8')

    const loaded = await Promise.all(Array.from({ length: 20 }, () => loadMcpToken(path)))

    expect(new Set(loaded.map(({ token }) => token))).toHaveProperty('size', 1)
    expect(loaded.every(({ source, tokenPath }) => source === 'profile' && tokenPath === path)).toBe(true)
    expect(loaded[0]!.token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect((await readFile(path, 'utf8')).trim()).toBe(loaded[0]!.token)
    expect(await readdir(directory)).toEqual(['mcp-token'])
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it.each(['write', 'close'])('cleans up a temporary token after a failed %s and allows startup retry', async (stage) => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-token-write-failure-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'mcp-token')
    const failure = Object.assign(new Error('token persistence failed'), { code: 'ENOSPC' })
    vi.mocked(open).mockImplementationOnce(async (file, flags, mode) => {
      const handle = await actualFs.open(file, flags, mode)
      if (stage === 'write') {
        vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => {
          await handle.write(Buffer.from('partial-token'))
          throw failure
        })
      } else {
        const close = handle.close.bind(handle)
        vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
          await close()
          throw failure
        })
      }
      return handle
    })

    await expect(loadMcpToken(path)).rejects.toBe(failure)
    expect(await readdir(directory)).toEqual([])

    const loaded = await loadMcpToken(path)
    expect((await readFile(path, 'utf8')).trim()).toBe(loaded.token)
    expect(await readdir(directory)).toEqual(['mcp-token'])
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('accepts only strong URL-safe environment tokens', async () => {
    const token = 'abcdefghijklmnopqrstuvwxyz_ABCDEFG-1234567890'
    await expect(loadMcpToken('/unused', token)).resolves.toEqual({ token, source: 'environment' })
    await expect(loadMcpToken('/unused', 'short')).rejects.toThrow('at least 32')
  })

  it('rejects an explicitly empty environment token without creating a profile token', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-token-empty-environment-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'profile', 'mcp-token')

    await expect(loadMcpToken(path, '')).rejects.toThrow('at least 32')
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
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

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HumanWaitingPersistence } from '../src/main/mcp/human-waiting-persistence.js'
import { HumanWaitingStore } from '../src/main/mcp/human-waiting-store.js'

let directory: string | undefined
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

describe('human waiting persistence', () => {
  it('distinguishes missing history from malformed or oversized history', async () => {
    directory = await mkdtemp(join(tmpdir(), 'hronaut-waiting-'))
    const path = join(directory, 'waiting.json')
    const persistence = new HumanWaitingPersistence(path)
    expect(await persistence.load()).toBeNull()
    await writeFile(path, '{"private":"not valid history"}')
    await expect(persistence.load()).rejects.toThrow('Human waiting history is unavailable or invalid')
    await writeFile(path, 'x'.repeat(1_048_577))
    await expect(persistence.load()).rejects.toThrow('Human waiting history is unavailable or invalid')
  })

  it('round trips validated snapshots and preserves the prior file on invalid writes', async () => {
    directory = await mkdtemp(join(tmpdir(), 'hronaut-waiting-'))
    const path = join(directory, 'waiting.json')
    const persistence = new HumanWaitingPersistence(path)
    const snapshot = new HumanWaitingStore().snapshot()
    await persistence.save(snapshot)
    expect(await persistence.load()).toEqual(snapshot)
    const before = await readFile(path, 'utf8')
    await expect(persistence.save({ ...snapshot, savedAt: NaN })).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(before)
  })
})

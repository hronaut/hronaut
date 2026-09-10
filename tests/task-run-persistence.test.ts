import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskRunPersistence } from '../src/main/mcp/task-run-persistence.js'
import { TaskRunStore } from '../src/main/mcp/task-run-store.js'

let directory: string | undefined
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

describe('task-run persistence', () => {
  it('distinguishes missing history from malformed and oversized history', async () => {
    directory = await mkdtemp(join(tmpdir(), 'hronaut-task-runs-'))
    const path = join(directory, 'task-runs.json')
    const persistence = new TaskRunPersistence(path)
    expect(await persistence.load()).toBeNull()
    await writeFile(path, '{"prompt":"private and invalid"}')
    await expect(persistence.load()).rejects.toThrow('unavailable or invalid')
    await writeFile(path, 'x'.repeat(262_145))
    await expect(persistence.load()).rejects.toThrow('unavailable or invalid')
  })

  it('round trips validated snapshots and preserves the prior file on invalid writes', async () => {
    directory = await mkdtemp(join(tmpdir(), 'hronaut-task-runs-'))
    const path = join(directory, 'task-runs.json')
    const persistence = new TaskRunPersistence(path)
    const snapshot = new TaskRunStore().snapshot()
    await persistence.save(snapshot)
    expect(await persistence.load()).toEqual(snapshot)
    const before = await readFile(path, 'utf8')
    await expect(persistence.save({ ...snapshot, savedAt: NaN })).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(before)
  })
})

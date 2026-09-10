import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { writeTextFileAtomically } from '../atomic-file.js'
import { taskRunSnapshotSchema, type TaskRunStore } from './task-run-store.js'

const MAX_HISTORY_BYTES = 262_144
type Snapshot = ReturnType<TaskRunStore['snapshot']>

/** Persists only the bounded task contract. Prompts, page text, credentials,
 * result bodies, and arbitrary artifact contents are outside this file.
 */
export class TaskRunPersistence {
  constructor(private readonly path: string) {}

  async load(): Promise<Snapshot | null> {
    let handle
    try {
      handle = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW)
      const info = await handle.stat()
      if (!info.isFile() || info.size > MAX_HISTORY_BYTES) throw new Error('Invalid history size')
      const buffer = Buffer.alloc(MAX_HISTORY_BYTES + 1)
      let used = 0
      while (used < buffer.length) {
        const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null)
        if (!bytesRead) break
        used += bytesRead
      }
      if (used > MAX_HISTORY_BYTES) throw new Error('History size exceeded')
      return taskRunSnapshotSchema.parse(JSON.parse(buffer.subarray(0, used).toString('utf8')))
    } catch (error) {
      if (!handle && (error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new Error('Task-run history is unavailable or invalid')
    } finally { await handle?.close() }
  }

  async save(snapshot: Snapshot): Promise<void> {
    const data = JSON.stringify(taskRunSnapshotSchema.parse(snapshot))
    if (Buffer.byteLength(data) > MAX_HISTORY_BYTES) throw new Error('Task-run history exceeds its size limit')
    await writeTextFileAtomically(this.path, data)
  }
}

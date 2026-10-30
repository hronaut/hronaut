import type { TaskManagerProcess } from '../types.js'
import type { InvokeChannel } from './channel.js'

/** The Task manager's view of Hronaut's processes. */
export const TASK_MANAGER_IPC = {
  /** Shell → main: every process with its memory and CPU use since the previous reading. */
  list: 'task-manager:list' as InvokeChannel<[], TaskManagerProcess[]>,
  /** Shell → main: ends a page process the list lets end. */
  endProcess: 'task-manager:end-process' as InvokeChannel<[pid: number], void>
} as const

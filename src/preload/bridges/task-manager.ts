import type { HronautTaskManagerApi } from '../../shared/types.js'
import { TASK_MANAGER_IPC } from '../../shared/ipc/task-manager.js'
import { invoke } from './ipc.js'

/** window.hronautTaskManager: Hronaut's processes, as Chrome's Task manager. */
export const taskManagerApi: HronautTaskManagerApi = {
  list: () => invoke(TASK_MANAGER_IPC.list),
  endProcess: (pid: number) => invoke(TASK_MANAGER_IPC.endProcess, pid)
}

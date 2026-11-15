import type { IpcMainInvokeEvent } from 'electron'
import type { TypedIpcMain } from './typed-ipc.js'
import type { Browser } from './browser/browser.js'
import { endTaskManagerProcess, taskManagerProcesses } from './browser/task-manager/task-manager.js'
import { TASK_MANAGER_IPC } from '../shared/ipc/task-manager.js'

interface TaskManagerIpcHost {
  /** The Task manager is the main window's own dialog. */
  assertMainSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc: TypedIpcMain['handle']
  tabs(): Browser | null
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerTaskManagerIpc(host: TaskManagerIpcHost): void {
  host.handleBrowserIpc(TASK_MANAGER_IPC.list, (event) => {
    host.assertMainSender(event)
    return taskManagerProcesses(host.tabs()!)
  })
  host.handleBrowserIpc(TASK_MANAGER_IPC.endProcess, (event, pid: unknown) => {
    host.assertMainSender(event)
    if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) throw new TypeError('Invalid process ID')
    endTaskManagerProcess(host.tabs()!, pid)
  })
}

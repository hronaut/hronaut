import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { Browser } from './browser/browser.js'
import { endTaskManagerProcess, taskManagerProcesses } from './browser/task-manager/task-manager.js'

interface TaskManagerIpcHost {
  /** The Task manager is the main window's own dialog. */
  assertMainSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  tabs(): Browser | null
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerTaskManagerIpc(host: TaskManagerIpcHost): void {
  host.handleBrowserIpc('task-manager:list', (event) => {
    host.assertMainSender(event)
    return taskManagerProcesses(host.tabs()!)
  })
  host.handleBrowserIpc('task-manager:end-process', (event, pid: unknown) => {
    host.assertMainSender(event)
    if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) throw new TypeError('Invalid process ID')
    endTaskManagerProcess(host.tabs()!, pid)
  })
}

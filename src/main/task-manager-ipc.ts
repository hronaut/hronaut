import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { Browser } from './browser/browser.js'

interface TaskManagerIpcHost {
  /** The Task manager is the main window's own dialog. */
  assertMainSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  tabs(): Pick<Browser, 'taskManagerProcesses' | 'endTaskManagerProcess'> | null
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerTaskManagerIpc(host: TaskManagerIpcHost): void {
  host.handleBrowserIpc('task-manager:list', (event) => {
    host.assertMainSender(event)
    return host.tabs()!.taskManagerProcesses()
  })
  host.handleBrowserIpc('task-manager:end-process', (event, pid: unknown) => {
    host.assertMainSender(event)
    if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) throw new TypeError('Invalid process ID')
    host.tabs()!.endTaskManagerProcess(pid)
  })
}

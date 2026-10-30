import type { IpcMainInvokeEvent } from 'electron'
import type { TypedIpcMain } from './typed-ipc.js'
import type { UndoOffers } from './undo-offers.js'
import { isUndoToken } from '../shared/undo.js'
import { UNDO_IPC } from '../shared/ipc/undo.js'

interface UndoIpcHost {
  /** Admits only the main window's shell document, not a detached panel window. */
  assertMainShellSender(event: IpcMainInvokeEvent): void
  /** The one action the person can undo now, offered in the shell's Undo toast. */
  undoOffers(): Pick<UndoOffers, 'undo' | 'hold' | 'finish'>
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerUndoIpc(ipcMain: Pick<TypedIpcMain, 'handle'>, host: UndoIpcHost): void {
  ipcMain.handle(UNDO_IPC.run, (event, token: unknown) => {
    host.assertMainShellSender(event)
    if (!isUndoToken(token)) throw new TypeError('Invalid undo token')
    return host.undoOffers().undo(token)
  })
  ipcMain.handle(UNDO_IPC.hold, (event, token: unknown) => {
    host.assertMainShellSender(event)
    if (!isUndoToken(token)) throw new TypeError('Invalid undo token')
    host.undoOffers().hold(token)
  })
  ipcMain.handle(UNDO_IPC.finish, (event, token: unknown) => {
    host.assertMainShellSender(event)
    if (!isUndoToken(token)) throw new TypeError('Invalid undo token')
    host.undoOffers().finish(token)
  })
}

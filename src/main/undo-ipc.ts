import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { UndoOffers } from './undo-offers.js'
import { isUndoToken } from '../shared/undo.js'

interface UndoIpcHost {
  /** Admits only the main window's shell document, not a detached panel window. */
  assertMainShellSender(event: IpcMainInvokeEvent): void
  /** The one action the person can undo now, offered in the shell's Undo toast. */
  undoOffers(): Pick<UndoOffers, 'undo' | 'hold' | 'finish'>
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerUndoIpc(ipcMain: Pick<IpcMain, 'handle'>, host: UndoIpcHost): void {
  ipcMain.handle('undo:run', (event, token: unknown) => {
    host.assertMainShellSender(event)
    if (!isUndoToken(token)) throw new TypeError('Invalid undo token')
    return host.undoOffers().undo(token)
  })
  ipcMain.handle('undo:hold', (event, token: unknown) => {
    host.assertMainShellSender(event)
    if (!isUndoToken(token)) throw new TypeError('Invalid undo token')
    host.undoOffers().hold(token)
  })
  ipcMain.handle('undo:finish', (event, token: unknown) => {
    host.assertMainShellSender(event)
    if (!isUndoToken(token)) throw new TypeError('Invalid undo token')
    host.undoOffers().finish(token)
  })
}

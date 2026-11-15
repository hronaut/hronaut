import { UNDO_IPC } from '../../shared/ipc/undo.js'
import type { HronautUndoApi } from '../../shared/types.js'
import { invoke, subscribe } from './ipc.js'

/** window.hronaut's Undo for the person's latest reversible action. */
export const undoApi: HronautUndoApi = {
  onUndoOffered: (listener) => subscribe(UNDO_IPC.offered, (offer) => listener(offer)),
  onUndoEnded: (listener) => subscribe(UNDO_IPC.ended, (token) => listener(token)),
  undo: (token) => invoke(UNDO_IPC.run, token),
  holdUndo: (token) => invoke(UNDO_IPC.hold, token),
  finishUndo: (token) => invoke(UNDO_IPC.finish, token)
}

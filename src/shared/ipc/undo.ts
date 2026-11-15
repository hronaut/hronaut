import type { UndoOffer } from '../undo.js'
import type { EventChannel, InvokeChannel } from './channel.js'

/** Undo for the person's latest reversible action, offered in the main window's Undo toast. */
export const UNDO_IPC = {
  /** Main → main window: offers to undo the person's latest reversible action, such as closing a tab. */
  offered: 'undo:offered' as EventChannel<[offer: UndoOffer]>,
  /** Main → main window: the offer with this token ended: used, closed, replaced by a newer one, or out of time. */
  ended: 'undo:ended' as EventChannel<[token: string]>,
  /** Main window → main: undoes the offered action; false when it is no longer offered or nothing came back. */
  run: 'undo:run' as InvokeChannel<[token: string], boolean>,
  /** Main window → main: the person is on the Undo toast, so the offer stays while the toast does, up to a minute. */
  hold: 'undo:hold' as InvokeChannel<[token: string], void>,
  /** Main window → main: the Undo toast closed without Undo. */
  finish: 'undo:finish' as InvokeChannel<[token: string], void>
} as const

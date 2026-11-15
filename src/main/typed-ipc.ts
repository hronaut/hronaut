import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import type { EventChannel, InvokeChannel, SendChannel, SyncChannel } from '../shared/ipc/channel.js'

/**
 * Answers an invoke channel with the channel's result. What the renderer sent arrives as unknown, since any page can
 * send anything, so the handler checks it before use.
 */
export type IpcHandler<Result> = (event: IpcMainInvokeEvent, ...args: unknown[]) => Result | Promise<Result>

/** A sync channel's message; main answers it by setting returnValue to the channel's result. */
type IpcSyncEvent<Result> = Omit<IpcMainEvent, 'returnValue'> & { returnValue: Result }

/**
 * Main's ipcMain as the registrations see it, each listener checked against its channel: a handler answers with the
 * invoke channel's result, and a sync listener sets the sync channel's. Electron's ipcMain is one.
 */
export interface TypedIpcMain {
  handle<Args extends unknown[], Result>(channel: InvokeChannel<Args, Result>, listener: NoInfer<IpcHandler<Result>>): void
  on<Args extends unknown[]>(channel: SendChannel<Args>, listener: (event: IpcMainEvent, ...args: unknown[]) => void): void
  on<Args extends unknown[], Result>(channel: SyncChannel<Args, Result>, listener: NoInfer<(event: IpcSyncEvent<Result>, ...args: unknown[]) => void>): void
}

/** Sends an event on a channel to one renderer, with the arguments the channel takes. */
export function sendTo<Args extends unknown[]>(contents: Pick<WebContents, 'send'>, channel: EventChannel<Args>, ...args: NoInfer<Args>): void {
  contents.send(channel, ...args)
}

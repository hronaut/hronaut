import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { EventChannel, InvokeChannel, SendChannel, SyncChannel } from '../../shared/ipc/channel.js'

/** Asks main on the channel, resolving with its answer. */
export function invoke<Args extends unknown[], Result>(channel: InvokeChannel<Args, Result>, ...args: NoInfer<Args>): Promise<Result> {
  return ipcRenderer.invoke(channel, ...args)
}

/** Asks main on the channel and waits for its answer, holding the page until main gives it. */
export function sendSync<Args extends unknown[], Result>(channel: SyncChannel<Args, Result>, ...args: NoInfer<Args>): Result {
  return ipcRenderer.sendSync(channel, ...args) as Result
}

/** Tells main on the channel, which answers nothing. */
export function send<Args extends unknown[]>(channel: SendChannel<Args>, ...args: NoInfer<Args>): void {
  ipcRenderer.send(channel, ...args)
}

/**
 * Calls the listener with what main sends on the channel, without the event, until the returned function is called.
 * Bridges pass on only the arguments their API names, so anything else main adds never reaches the shell.
 */
export function subscribe<Args extends unknown[]>(channel: EventChannel<Args>, listener: (...args: NoInfer<Args>) => void): () => void {
  const handler = (_event: IpcRendererEvent, ...args: unknown[]): void => listener(...args as Args)
  ipcRenderer.on(channel, handler)
  return () => { ipcRenderer.removeListener(channel, handler) }
}

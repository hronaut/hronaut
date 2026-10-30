import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { EventChannel, InvokeChannel } from '../../shared/ipc/channel.js'

/** Asks main on the channel, resolving with its answer. */
export function invoke<Args extends unknown[], Result>(channel: InvokeChannel<Args, Result>, ...args: NoInfer<Args>): Promise<Result> {
  return ipcRenderer.invoke(channel, ...args)
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

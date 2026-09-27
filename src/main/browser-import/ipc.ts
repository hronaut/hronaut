import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { BrowserImportResponse } from '../../shared/browser-import.js'
import { BrowserImportService, type ImportDestination } from './service.js'
import { BrowserImportError } from './contracts.js'
import { discoverImportProfiles, readImportCookies } from './source.js'
import type { BrowserImportProfile, BrowserImportResult } from '../../shared/browser-import.js'
import type { Cookie } from 'electron'

interface Options {
  assertSender(event: IpcMainInvokeEvent): void
  destination(id: string): ImportDestination
  consent(profile: BrowserImportProfile, destination: ImportDestination): Promise<boolean>
  write(destination: ImportDestination, cookies: Cookie[]): Promise<BrowserImportResult>
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 256) throw new BrowserImportError('expired')
  return value
}
export function registerBrowserImportIpc(options: Options): () => void {
  const service = new BrowserImportService({ ...options, discover: () => discoverImportProfiles(), read: readImportCookies })
  const handle = <T>(channel: string, run: (...values: unknown[]) => Promise<T>): void => {
    ipcMain.handle(channel, async (event, ...values: unknown[]): Promise<BrowserImportResponse<T>> => {
      options.assertSender(event)
      try { return { ok: true, value: await run(...values) } }
      catch (error) { return { ok: false, error: error instanceof BrowserImportError ? error.code : 'failed' } }
    })
  }
  handle('browser-import:list', id => service.list(identifier(id)))
  handle('browser-import:preview', (id, profile) => service.preview(identifier(id), identifier(profile)))
  handle('browser-import:commit', (id, domains) => {
    if (!Array.isArray(domains) || domains.length > 20_000 || domains.some(d => typeof d !== 'string' || d.length > 253)) throw new BrowserImportError('expired')
    return service.commit(identifier(id), domains as string[])
  })
  ipcMain.handle('browser-import:cancel', event => { options.assertSender(event); service.cancel() })
  return () => service.cancel()
}

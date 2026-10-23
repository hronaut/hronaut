import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
  OpenDialogOptions,
  OpenDialogReturnValue
} from 'electron'
import { CredentialImportError, parseCredentialImportCsv } from './credential-import.js'
import { readCredentialImportFile } from './credential-import-file.js'
import { fillCredentialWhileMcpPaused } from './credential-fill-pause.js'
import type { BrowserTabsManager } from './browser/tabs-manager.js'
import type { CredentialStore } from './credential-store.js'
import type { McpActionTracker } from './mcp/action-tracker.js'
import type { McpHttpServer } from './mcp/server.js'
import type { TrustedDialogOptions } from './trusted-dialogs/trusted-dialogs.js'
import type { MessageKey, MessageParameters } from '../shared/i18n.js'
import type { CredentialImportResult, CredentialStorageStatus } from '../shared/types.js'

interface CredentialsIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  /** Whether secure storage is available; read on every use because it is replaced once storage is configured. */
  credentialStorageStatus(): CredentialStorageStatus
  credentialStore(): Pick<CredentialStore, 'list' | 'remove' | 'clear' | 'password' | 'importMany'> | null
  publishCredentials(): void
  tabs(): Pick<BrowserTabsManager, 'credentialContext' | 'fillCredential'> | null
  mainWindow(): BrowserWindow | null
  /** Electron's `dialog.showOpenDialog` on the given window. */
  showOpenDialog(window: BrowserWindow, options: OpenDialogOptions): Promise<OpenDialogReturnValue>
  /** Asks in Hronaut's own dialog over the main window's pages, or in the system dialog while that window cannot show it. */
  showDialog(options: Omit<TrustedDialogOptions, 'window'>): Promise<{ response: number }>
  text(key: MessageKey, parameters?: MessageParameters): string
  setMcpPaused(paused: boolean): void
  acquireTemporaryMcpPause(): () => void
  mcpServer(): Pick<McpHttpServer, 'getActiveRequestCount'> | null
  mcpActionTracker(): Pick<McpActionTracker, 'activeCount'>
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerCredentialsIpc(ipcMain: Pick<IpcMain, 'handle'>, host: CredentialsIpcHost): void {
  function credentialImportErrorMessage(error: unknown): string {
    if (!(error instanceof CredentialImportError)) return host.text('native.errors.passwordImportInvalid')
    const keys = {
      invalid_csv: 'native.errors.passwordImportInvalid',
      missing_columns: 'native.errors.passwordImportColumns',
      too_many_rows: 'native.errors.passwordImportRows',
      no_credentials: 'native.errors.passwordImportEmpty'
    } as const
    return host.text(keys[error.code])
  }

  // Reads the window and store through the host at every use, including after each await, as the main entry did:
  // either can be replaced or closed while a dialog is open, so do not capture them once.
  async function importCredentialsFromCsv(): Promise<CredentialImportResult> {
    const canceled: CredentialImportResult = { canceled: true, added: 0, updated: 0, skipped: 0 }
    if (!host.credentialStorageStatus().available || !host.credentialStore()) {
      throw new Error(host.credentialStorageStatus().reason || host.text('native.errors.secureStorage'))
    }
    if (!host.mainWindow() || host.mainWindow()!.isDestroyed()) throw new Error(host.text('native.errors.actionFailed'))
    const selection = await host.showOpenDialog(host.mainWindow()!, {
      title: host.text('native.dialog.importPasswordsFile'),
      buttonLabel: host.text('native.dialog.choosePasswordFile'),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      properties: ['openFile', 'dontAddToRecent']
    })
    const path = selection.filePaths[0]
    if (selection.canceled || !path) return canceled

    let source: string
    try {
      source = await readCredentialImportFile(path)
    } catch (error) {
      if (error instanceof Error && error.message === 'too-large') {
        throw new Error(host.text('native.errors.passwordImportTooLarge'))
      }
      throw new Error(host.text('native.errors.passwordImportRead'))
    }

    let parsed
    try {
      parsed = parseCredentialImportCsv(source)
    } catch (error) {
      throw new Error(credentialImportErrorMessage(error))
    }
    const current = new Set(host.credentialStore()!.list().map((entry) => `${entry.origin}\u0000${entry.username}`))
    const unique = new Set(parsed.credentials.map((entry) => `${entry.origin}\u0000${entry.username}`))
    const updated = [...unique].filter((identity) => current.has(identity)).length
    const added = unique.size - updated
    const skipped = parsed.skippedRows + parsed.credentials.length - unique.size
    const confirmation = await host.showDialog({
      type: 'warning',
      title: host.text('native.dialog.importPasswordsTitle'),
      message: host.text('native.dialog.importPasswordsMessage', { count: unique.size }),
      detail: host.text('native.dialog.importPasswordsDetail', {
        added,
        updated,
        skipped,
        backend: host.credentialStorageStatus().backend || host.text('common.system')
      }),
      buttons: [host.text('native.dialog.cancel'), host.text('native.dialog.importPasswords')],
      defaultId: 1,
      cancelId: 0,
      primaryId: 1,
      noLink: true,
      variant: { kind: 'message', topic: 'passwords' }
    })
    if (confirmation.response !== 1) return canceled

    const result = await host.credentialStore()!.importMany(parsed.credentials)
    host.publishCredentials()
    return {
      canceled: false,
      added: result.added,
      updated: result.updated,
      skipped: parsed.skippedRows + result.duplicateRows
    }
  }

  ipcMain.handle('credentials:status', (event) => {
    host.assertTrustedSender(event)
    return { ...host.credentialStorageStatus() }
  })
  ipcMain.handle('credentials:list', (event) => {
    host.assertTrustedSender(event)
    return host.credentialStore()?.list() ?? []
  })
  ipcMain.handle('credentials:import-csv', async (event) => {
    host.assertTrustedSender(event)
    return importCredentialsFromCsv()
  })
  host.handleBrowserIpc('credentials:fill', async (event, tabId: unknown, credentialId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    if (typeof credentialId !== 'string') throw new TypeError('Invalid credential ID')
    const activeCredentialStore = host.credentialStore()
    const activeTabsManager = host.tabs()
    if (!host.credentialStorageStatus().available || !activeCredentialStore || !activeTabsManager) return false
    const context = activeTabsManager.credentialContext(tabId)
    if (!context) return false
    const selected = activeCredentialStore.list().find((credential) => credential.id === credentialId && credential.origin === context.origin)
    if (!selected) return false
    return fillCredentialWhileMcpPaused({
      pausePersistently: () => { host.setMcpPaused(true) },
      acquireTemporaryPause: host.acquireTemporaryMcpPause,
      getActiveRequestCount: () => host.mcpServer()?.getActiveRequestCount() ?? host.mcpActionTracker().activeCount,
      fill: async () => {
        const password = await activeCredentialStore.password(selected.id)
        return activeTabsManager.fillCredential(tabId, context, selected.username, password)
      }
    })
  })
  ipcMain.handle('credentials:remove', async (event, id: unknown) => {
    host.assertTrustedSender(event)
    if (typeof id !== 'string') throw new TypeError('Invalid credential ID')
    const removed = await host.credentialStore()?.remove(id) ?? false
    if (removed) host.publishCredentials()
    return removed
  })
  ipcMain.handle('credentials:clear', async (event) => {
    host.assertTrustedSender(event)
    await host.credentialStore()?.clear()
    host.publishCredentials()
  })
}

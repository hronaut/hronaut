import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { Browser } from './browser/browser.js'

type PageGeometryIpcTabs = Pick<Browser,
  | 'getSplitDivider' | 'getEmulationFrames' | 'getPageCards'
  | 'beginSplitDivider' | 'updateSplitDivider' | 'finishSplitDivider' | 'setSplitDividerRatio'>

interface PageGeometryIpcHost {
  /** Admits only the main window's shell document, not a detached panel window. */
  assertMainShellSender(event: IpcMainInvokeEvent): void
  /**
   * Registers a handler that is refused while saved workspaces are still initializing or failed to start;
   * the three geometry reads are admitted and wait in `runWorkspaceRead` instead.
   */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  /** Checks the sender, then reads once saved workspaces are initialized, dropping the read if its sender navigates away. */
  runWorkspaceRead<T>(event: IpcMainInvokeEvent, assertSender: (event: IpcMainInvokeEvent) => void, read: () => T): Promise<T>
  tabs(): PageGeometryIpcTabs | null
}

/**
 * Where the shell draws over the pages: the split-view divider and its drag gesture, page cards, and the
 * frames around emulated pages. Dependencies stay lazy because handlers are registered before the window loads.
 */
export function registerPageGeometryIpc(host: PageGeometryIpcHost): void {
  host.handleBrowserIpc('split-divider:get', (event) => host.runWorkspaceRead(event, host.assertMainShellSender, () => host.tabs()!.getSplitDivider()))
  host.handleBrowserIpc('emulation-frame:get', (event) => host.runWorkspaceRead(event, host.assertMainShellSender, () => host.tabs()!.getEmulationFrames()))
  host.handleBrowserIpc('page-card:get', (event) => host.runWorkspaceRead(event, host.assertMainShellSender, () => host.tabs()!.getPageCards()))
  host.handleBrowserIpc('split-divider:begin', (event, revision: unknown) => {
    host.assertMainShellSender(event)
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw new TypeError('Invalid split revision')
    return host.tabs()!.beginSplitDivider(revision)
  })
  host.handleBrowserIpc('split-divider:update', (event, token: unknown, ratio: unknown) => {
    host.assertMainShellSender(event)
    if (typeof token !== 'string' || token.length > 64 || typeof ratio !== 'number' || !Number.isFinite(ratio)) throw new TypeError('Invalid split gesture update')
    return host.tabs()!.updateSplitDivider(token, ratio)
  })
  host.handleBrowserIpc('split-divider:finish', (event, token: unknown, commit: unknown, ratio: unknown) => {
    host.assertMainShellSender(event)
    if (typeof token !== 'string' || token.length > 64 || typeof commit !== 'boolean'
      || (ratio !== undefined && (typeof ratio !== 'number' || !Number.isFinite(ratio)))) throw new TypeError('Invalid split gesture completion')
    return host.tabs()!.finishSplitDivider(token, commit, ratio as number | undefined)
  })
  host.handleBrowserIpc('split-divider:set-ratio', (event, revision: unknown, ratio: unknown) => {
    host.assertMainShellSender(event)
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0
      || typeof ratio !== 'number' || !Number.isFinite(ratio)) throw new TypeError('Invalid split divider ratio')
    return host.tabs()!.setSplitDividerRatio(revision, ratio)
  })
}

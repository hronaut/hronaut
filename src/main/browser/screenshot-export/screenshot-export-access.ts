import type { WebContents, WebContentsView } from 'electron'
import type { BrowserEmulationState } from '../../../shared/types.js'

/**
 * The tab fields a screenshot export reads: the page and its view, its title,
 * its workspace, its document generation, and its emulated viewport with the
 * size its view was given for it.
 */
export interface ScreenshotExportTab {
  id: string
  title: string
  mcpGroupId?: string
  navigationGeneration: number
  webContents: WebContents
  view: WebContentsView
  emulation: BrowserEmulationState
  emulationViewSize?: { width: number; height: number }
}

/**
 * What a screenshot export needs from the tab manager, which keeps the tabs,
 * workspaces, inspection permissions, page presentation, the agent pointer,
 * display scaling, download writing and the export file name private. A
 * workspace is opaque here: the export only compares it by identity and reads
 * its inspection permission generation.
 */
export interface ScreenshotExportAccess<Tab extends ScreenshotExportTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  findWorkspace(workspaceId: string): object | undefined
  inspectionPermission(workspace: object): number | undefined
  isDestroyed(): boolean
  withRenderableTab<T>(tab: Tab, operation: () => Promise<T>, mode?: 'presented-frame' | 'surface' | 'print'): Promise<T>
  dismissAgentPointer(webContents: WebContents): Promise<void>
  /**
   * The device pixels per CSS pixel a capture of the tab can have: the largest
   * display scale, since a hidden window captures offscreen on whichever
   * display is nearest. It throws while the tab's emulation is unconfirmed.
   */
  captureScale(tab: Tab): number
  writeUniqueDownload(filename: string, data: Buffer, validate?: () => void): Promise<string>
  screenshotFilename(requested: string | undefined, title: string): string
}

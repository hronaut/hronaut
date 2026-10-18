import type { WebContents } from 'electron'

/** The tab fields a PDF export reads: the page, its title, its workspace and its document generation. */
export interface PdfExportTab {
  id: string
  title: string
  mcpGroupId?: string
  navigationGeneration: number
  webContents: WebContents
}

/**
 * What a PDF export needs from the tab manager, which keeps the tabs,
 * workspaces, inspection permissions, page presentation, the agent pointer,
 * download writing and the export file name private. A workspace is opaque
 * here: the export only compares it by identity and reads its inspection
 * permission generation. The file name helper stays in the manager so the
 * portable file name module is still first evaluated where the manager imports
 * it.
 */
export interface PdfExportAccess<Tab extends PdfExportTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  findWorkspace(workspaceId: string): object | undefined
  inspectionPermission(workspace: object): number | undefined
  isDestroyed(): boolean
  withRenderableTab<T>(tab: Tab, operation: () => Promise<T>, mode?: 'presented-frame' | 'surface' | 'print'): Promise<T>
  dismissAgentPointer(webContents: WebContents): Promise<void>
  writeUniqueDownload(filename: string, data: Buffer, validate?: () => void): Promise<string>
  pdfFilename(requested: string | undefined, title: string): string
}

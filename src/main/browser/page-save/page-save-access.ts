import type { SaveDialogOptions, SaveDialogReturnValue, WebContents } from 'electron'
import type { MessageKey } from '../../../shared/i18n.js'

/** The tab fields saving its page reads: its id, its address, whether it sleeps, and its page. */
export interface PageSaveTab {
  id: string
  url: string
  sleeping: boolean
  webContents: WebContents
}

/**
 * What saving a page for the person needs from the tab manager, which keeps the shown tab, trusted chrome occlusion,
 * the human input lock, the download folder, the window's save dialog and the pages being saved now private.
 */
export interface PageSaveAccess<Tab extends PageSaveTab> {
  /** The tab the window shows, if any: in split view, the pane the person last used. */
  shownTab(): Tab | undefined
  /** Whether trusted chrome covers the pages, which then stay on screen only for their snapshot. */
  browserContentOccluded(): boolean
  /** Whether the tab's human input lock holds the person's input back from the page. */
  isHumanInteractionLocked(tab: Tab): boolean
  /** The folder downloads go to, where the save dialog opens. */
  downloadDirectory(): string
  /** Shows the system's save dialog over Hronaut's window. */
  showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogReturnValue>
  text(key: MessageKey): string
  /** The pages whose save dialog is open or that are being saved, by WebContents id. */
  savingWebContents(): Set<number>
}

import type { WebContents } from 'electron'

/**
 * The tab fields loading a website's icon reads and writes: the page, whose
 * session fetches the icon, the icon itself, and the request number and abort
 * controller that let a newer icon list supersede an older one.
 */
export interface TabFaviconTab {
  webContents: WebContents
  faviconDataUrl?: string
  faviconRequestId: number
  faviconAbortController?: AbortController
}

/**
 * What loading a website's icon needs from the tab manager, which keeps its
 * destroyed flag, the shell's own page, which decodes icon formats the native
 * decoder cannot, and state publication private.
 */
export interface TabFaviconAccess {
  isDestroyed(): boolean
  windowWebContents(): WebContents
  changed(persist?: boolean): void
}

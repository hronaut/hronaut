import type { WebContents } from 'electron'
import type { BrowserPageProblem } from '../../../shared/types.js'

/** The tab fields page waits read. */
export interface PageWaitsTab {
  id: string
  url: string
  webContents: WebContents
  pageProblem?: BrowserPageProblem
}

/**
 * What page waits need from the tab manager, which keeps the tabs, target
 * validation and renderer recovery private. Renderer recovery is consulted so
 * an intentional renderer replacement does not end a page-load wait.
 */
export interface PageWaitsAccess {
  getTab(tabId?: string): PageWaitsTab
  hasTab(tabId: string): boolean
  validateTarget(target: { ref?: string; selector?: string }): void
  rendererExpectsExit(webContents: WebContents): boolean
}

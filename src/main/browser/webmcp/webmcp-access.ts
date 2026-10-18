import type { WebContents } from 'electron'
import type { BrowserSnapshot } from '../../../shared/snapshot.js'

/** The tab fields WebMCP reads. */
export interface WebMcpTab {
  id: string
  url: string
  navigationGeneration: number
  webContents: WebContents
}

/**
 * What WebMCP needs from the tab manager, which keeps the tabs, snapshots and
 * the descriptor cache private. The cache belongs to one manager, so a call
 * can only use a descriptor that this runtime listed for the same document.
 */
export interface WebMcpAccess {
  getTab(tabId?: string): WebMcpTab
  findTab(tabId: string): WebMcpTab | undefined
  descriptorCache(): Map<string, string>
  snapshotDetails(tabId: string, maxChars: number): Promise<BrowserSnapshot>
}

import type { WebContents } from 'electron'

/** The pages Chromium has yet to answer an agent's file drop on, with how many drops it has yet to answer. */
const unansweredDrops = new WeakMap<WebContents, number>()

/**
 * Marks the page from when an agent's file drop is sent to it until Chromium answers that drop, however long the page's
 * own drop handler holds it, even past the drop's own wait: the window Chromium opens for a dropped file the page does
 * not take comes before that answer, and is the agent's.
 */
export function markAgentFileDrop(webContents: WebContents, drop: Promise<unknown>): void {
  unansweredDrops.set(webContents, (unansweredDrops.get(webContents) ?? 0) + 1)
  const answered = (): void => {
    const left = (unansweredDrops.get(webContents) ?? 1) - 1
    if (left > 0) unansweredDrops.set(webContents, left)
    else unansweredDrops.delete(webContents)
  }
  drop.then(answered, answered)
}

/** Whether Chromium has yet to answer an agent's file drop on the page. */
export function agentFileDropUnanswered(webContents: WebContents): boolean {
  return unansweredDrops.has(webContents)
}

import { expect, type ElectronApplication } from '@playwright/test'

/**
 * Native input refuses when main moves its page while the call waits, and the
 * toolbar can still be settling just after a tab is created and selected. Wait
 * until the page's bounds stop changing so native input sees only the movement
 * a test causes.
 */
export async function waitForSettledPageBounds(app: ElectronApplication, url: string): Promise<void> {
  let last: string | undefined
  let since = Date.now()
  await expect.poll(async () => {
    const bounds = await app.evaluate(({ BrowserWindow, WebContentsView }, url) => BrowserWindow.getAllWindows()
      .flatMap(window => window.contentView.children)
      .find(view => view instanceof WebContentsView && view.webContents.getURL() === url)?.getBounds(), url)
    const current = JSON.stringify(bounds)
    if (current !== last) { last = current; since = Date.now() }
    return bounds ? Date.now() - since : 0
  }, { message: 'the page stops moving', intervals: [100] }).toBeGreaterThanOrEqual(500)
}

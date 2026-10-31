import { createServer } from 'node:http'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'

// A website dialog answered for the person, such as one turned down while Settings covered the pages, or one an agent
// answered, left Electron's box for it on screen. The box kept Hronaut's window disabled until the person clicked it.

const windowEnabled = (electronApp: ElectronApplication) => electronApp.evaluate(({ BrowserWindow }) => (
  BrowserWindow.getAllWindows().find((window) => window.isVisible())!.isEnabled()
))

const pageTitle = (electronApp: ElectronApplication, url: string) => electronApp.evaluate(({ webContents }, url) => (
  webContents.getAllWebContents().find((contents) => contents.getURL() === url)?.getTitle()
), url)

/** The page shows an alert on its own, as from a timer, and renames itself once the alert is answered. */
function alertFromPage(electronApp: ElectronApplication, url: string): Promise<void> {
  return electronApp.evaluate(({ webContents }, url) => {
    void webContents.getAllWebContents().find((contents) => contents.getURL() === url)!
      .executeJavaScript('setTimeout(() => { alert("Unsaved draft"); document.title = "Answered" }, 0); true')
  }, url)
}

test('closes the box of a website dialog answered for the person', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Alerting page</title>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  // Playwright would answer the page's dialogs itself; Hronaut and the person answer them here.
  const leaveDialogs = (page: Page) => page.on('dialog', () => undefined)
  for (const page of electronApp.context().pages()) leaveDialogs(page)
  electronApp.context().on('page', leaveDialogs)
  try {
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => pageTitle(electronApp, url)).toBe('Alerting page')
    expect(await windowEnabled(electronApp)).toBe(true)

    // Settings covers the pages, so Hronaut turns the page's alert down, and the window stays usable.
    await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = appWindow.getByRole('tabpanel', { name: 'Settings' })
    await expect(settings).toBeVisible()
    await alertFromPage(electronApp, url)
    await expect.poll(() => pageTitle(electronApp, url)).toBe('Answered')
    await expect.poll(() => windowEnabled(electronApp)).toBe(true)
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click()
    await expect(settings).toHaveCount(0)
    // The page is covered until Settings has finished closing, and only then shows its own dialogs.
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows()
      .find((window) => window.isVisible())!.contentView.children
      .some((view) => (view as Electron.WebContentsView).webContents?.getURL() === url && view.getVisible()), url)).toBe(true)

    // An alert the person sees, answered through the page's debugger as an agent's browser_dialog does.
    await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .find((contents) => contents.getURL() === url)!.executeJavaScript('document.title = "Alerting page"'), url)
    await alertFromPage(electronApp, url)
    await expect.poll(async () => {
      const state = await appWindow.evaluate('window.hronaut.getState()') as { tabs: Array<{ url: string, dialog?: { message: string } }> }
      return state.tabs.find((tab) => tab.url === url)?.dialog?.message
    }).toBe('Unsaved draft')
    await electronApp.evaluate(async ({ webContents }, url) => {
      await webContents.getAllWebContents().find((contents) => contents.getURL() === url)!
        .debugger.sendCommand('Page.handleJavaScriptDialog', { accept: true })
    }, url)
    await expect.poll(() => pageTitle(electronApp, url)).toBe('Answered')
    await expect.poll(() => windowEnabled(electronApp)).toBe(true)
  } finally {
    await closeFixtureServer(server)
  }
})

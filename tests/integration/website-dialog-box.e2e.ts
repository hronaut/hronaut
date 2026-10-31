import { createServer } from 'node:http'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'

// A website dialog Hronaut turned down while Settings covered the pages left Electron's box for it on screen, over
// Settings. The box kept Hronaut's window disabled until the person clicked it. An agent's answer is covered in
// website-dialog-agent.e2e.ts.

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
  } finally {
    await closeFixtureServer(server)
  }
})

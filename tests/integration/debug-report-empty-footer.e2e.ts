import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

// In a window 760 px high, a debug report with nothing to show kept its full height and pushed Refresh and Copy report
// partly out of the panel.

test('keeps the actions of an empty debug report in view in a short window', async ({ appWindow, electronApp }) => {
  // With a Content-Security-Policy, Electron logs no security warning to the page's console, so the report is empty.
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "default-src 'none'" })
    response.end('<!doctype html><title>Quiet page</title><main><h1>Quiet page</h1></main>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const windowHigh = async (height: number): Promise<void> => {
    await electronApp.evaluate(({ BrowserWindow }, height) => BrowserWindow.getAllWindows()[0]!.setSize(1000, height), height)
    await expect.poll(() => appWindow.evaluate(() => innerHeight)).toBe(height)
  }
  try {
    await appWindow.evaluate(`window.hronaut.newTab({ url: 'http://127.0.0.1:${address.port}/', active: true })`)
    // The page committed, so its load no longer resets the panel.
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.title)')).toBe('Quiet page')
    await windowHigh(1000)
    await appWindow.locator('.page-tools-button').click()
    const tools = appWindow.getByRole('dialog', { name: 'Page tools', exact: true })
    await tools.locator('.page-tools-grid button').filter({ has: appWindow.locator('strong', { hasText: /^Debug report$/ }) }).click()
    const report = appWindow.getByRole('dialog', { name: 'Debug report', exact: true })
    const empty = report.getByText('No console messages or failed requests captured')
    await expect(empty).toBeVisible()
    const actionsInView = async (): Promise<void> => {
      for (const name of ['Refresh', 'Copy report']) {
        await expect(report.locator(':scope > footer').getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 })
      }
    }
    // A tall window shows the empty state at its full height, as before.
    await actionsInView()
    await expect.poll(() => report.locator('.debug-report-empty').evaluate(element => element.getBoundingClientRect().height)).toBe(260)

    await windowHigh(760)
    await actionsInView()
    // The report scrolls under the footer instead, and its message can still be read.
    await expect.poll(() => report.locator('.panel-scroll-body').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await empty.scrollIntoViewIfNeeded()
    await expect(empty).toBeInViewport({ ratio: 1 })
    await actionsInView()
    // The closed incident review keeps its whole line rather than squeezing into a scroll of its own.
    expect(await report.locator('.incident-review').evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(0)
  } finally {
    await closeFixtureServer(server)
  }
})

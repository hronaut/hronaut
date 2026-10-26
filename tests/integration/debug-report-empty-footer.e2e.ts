import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

// In a window 760 px high, a debug report with nothing to show kept its full height and pushed Refresh and Copy report
// partly out of the panel.

test('keeps the actions of an empty debug report in view in a window 760 px high', async ({ appWindow, electronApp }) => {
  // With a Content-Security-Policy, Electron logs no security warning to the page's console, so the report is empty.
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "default-src 'none'" })
    response.end('<!doctype html><title>Quiet page</title><main><h1>Quiet page</h1></main>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  try {
    await appWindow.evaluate(`window.hronaut.newTab({ url: 'http://127.0.0.1:${address.port}/', active: true })`)
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 760))
    await expect.poll(() => appWindow.evaluate(() => innerHeight)).toBe(760)
    await appWindow.locator('.page-tools-button').click()
    const tools = appWindow.getByRole('dialog', { name: 'Page tools', exact: true })
    await tools.locator('.page-tools-grid button').filter({ has: appWindow.locator('strong', { hasText: /^Debug report$/ }) }).click()
    const report = appWindow.getByRole('dialog', { name: 'Debug report', exact: true })
    await expect(report.getByText('No console messages or failed requests captured')).toBeVisible()
    for (const name of ['Refresh', 'Copy report']) {
      await expect(report.locator(':scope > footer').getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 })
    }
    // The empty state still shows all of its message.
    expect(await report.locator('.debug-report-empty').evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(0)
  } finally {
    await closeFixtureServer(server)
  }
})

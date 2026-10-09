import { createServer, type ServerResponse } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('refreshes a pending selection after completion without replaying its request', async ({ appWindow, electronApp }) => {
  let held: ServerResponse | undefined
  let requests = 0
  const server = createServer((request, response) => {
    if (request.url === '/delayed-response') {
      requests += 1
      held = response
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<html><title>Refresh selected details</title><main>Network fixture</main></html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  try {
    const state = await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    const tabId = state.activeTabId!
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === url)!
    const retained = () => appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.listNetworkRequests(tabId), tabId)
    await retained()
    await page.evaluate(() => { void fetch('/delayed-response').then(response => response.text()) })
    await expect.poll(async () => (await retained()).some(entry => entry.url.endsWith('/delayed-response'))).toBe(true)
    await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
    await appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('button', { name: 'Open network monitor', exact: true }).click()
    const panel = appWindow.getByRole('dialog', { name: 'Network', exact: true })
    const search = panel.getByRole('searchbox', { name: 'Filter network requests', exact: true })
    await search.fill('delayed-response')
    await panel.getByRole('listbox', { name: 'Network requests' }).getByRole('option').click()
    await expect(panel.locator('.network-detail-heading')).toContainText('Pending')
    held!.writeHead(200, { 'content-type': 'application/json' })
    held!.end(JSON.stringify({ visible: 'finished response', accessToken: 'private-refresh-canary' }))
    await expect.poll(async () => (await retained()).some(entry => entry.url.endsWith('/delayed-response') && entry.completedAt)).toBe(true)
    await expect(panel.locator('.network-detail-heading')).toContainText('Pending')
    await panel.getByRole('button', { name: 'Refresh selected request details', exact: true }).click()
    await expect(panel.locator('.network-detail-heading')).toContainText('200')
    await expect(search).toHaveValue('delayed-response')
    const body = panel.locator('summary').filter({ hasText: /^Response body/ }).locator('..')
    await body.locator('summary').click()
    await expect(body.locator('pre')).toContainText('finished response')
    await expect(body.locator('pre')).toContainText('[REDACTED]')
    await expect(body.locator('pre')).not.toContainText('private-refresh-canary')
    expect(requests).toBe(1)
    expect((await retained()).filter(entry => entry.url.endsWith('/delayed-response'))).toHaveLength(1)
  } finally {
    held?.destroy()
    await closeFixtureServer(server)
  }
})

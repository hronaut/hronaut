import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'
import type { BrowserState } from '../../src/shared/types.js'

test('filters retained storage across keys, values and cookie domains without changing hidden entries', async ({ appWindow }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html',
      'set-cookie': ['theme=dark; Path=/', 'protected-session=fixture-only-secret; HttpOnly; Path=/']
    })
    response.end(`<title>Storage search fixture</title><script>
      localStorage.setItem('theme', 'dark'); localStorage.setItem('accent', 'blue');
      sessionStorage.setItem('theme', 'light'); sessionStorage.setItem('accent', 'green');
    </script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing storage fixture address')
    const state = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`http://127.0.0.1:${address.port}/`)}, active: true })`) as BrowserState
    const tabId = state.activeTabId
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.title)')).toBe('Storage search fixture')
    await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
    await appWindow.getByRole('button', { name: 'Site storage for 127.0.0.1', exact: true }).click()
    const panel = appWindow.getByRole('dialog', { name: 'Site storage · 127.0.0.1', exact: true })
    const search = panel.getByRole('searchbox', { name: 'Filter site storage', exact: true })
    await expect(panel.locator('.site-storage-item')).toHaveCount(2)
    await search.fill('DARK theme')
    await expect(panel.locator('.site-storage-item')).toHaveCount(1)
    await expect(panel.getByRole('button', { name: 'Delete theme', exact: true })).toBeVisible()
    await search.fill('theme blue')
    await expect(panel.getByText('No matching entries', { exact: true })).toBeVisible()
    await search.fill('theme dark')
    await panel.getByRole('button', { name: 'Delete theme', exact: true }).click()
    await expect(panel.getByText('No matching entries', { exact: true })).toBeVisible()
    await search.fill('')
    await expect(panel.locator('.site-storage-item')).toHaveCount(1)
    await expect(panel.getByRole('button', { name: 'Delete accent', exact: true })).toBeVisible()
    const retained = await appWindow.evaluate(`window.hronaut.manageStorage({ tabId: ${JSON.stringify(tabId)}, kind: 'local-storage', action: 'list', includeValues: true })`) as { items: { key: string; value: string }[] }
    expect(retained.items).toEqual([expect.objectContaining({ key: 'accent', value: 'blue' })])
    await panel.getByRole('button', { name: 'Session', exact: true }).click()
    await search.fill('theme light')
    await expect(panel.locator('.site-storage-item')).toHaveCount(1)
    await expect(panel.getByRole('button', { name: 'Delete theme', exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Cookies', exact: true }).click()
    await search.fill('theme dark 127.0.0.1')
    await expect(panel.locator('.site-storage-item')).toHaveCount(1)
    await expect(panel.getByRole('button', { name: 'Delete theme', exact: true })).toBeVisible()
    await search.fill('protected-session 127.0.0.1')
    await expect(panel.locator('.site-storage-item')).toHaveCount(1)
    await expect(panel.getByRole('button', { name: 'protected-session is HttpOnly and protected', exact: true })).toBeDisabled()
    await expect(panel).not.toContainText('fixture-only-secret')
    await search.fill('fixture-only-secret')
    await expect(panel.getByText('No matching entries', { exact: true })).toBeVisible()
  } finally {
    await closeFixtureServer(server)
  }
})

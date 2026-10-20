import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'
import { answerConfirmations } from './confirmation-fixture.js'
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

test('deletes only the cookie row chosen and keeps HttpOnly cookies when clearing cookies', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html',
      'set-cookie': ['pref=root; Path=/', 'pref=app; Path=/app', 'sid=signed-in; HttpOnly; Path=/', 'sid=guest; Path=/app']
    })
    response.end('<title>Cookie rows fixture</title>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing cookie fixture address')
    const state = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`http://127.0.0.1:${address.port}/app/page`)}, active: true })`) as BrowserState
    const tabId = state.activeTabId
    const cookies = async () => ((await appWindow.evaluate(`window.hronaut.manageStorage({ tabId: ${JSON.stringify(tabId)}, kind: 'cookies', action: 'list' })`)) as { items: Array<{ key: string; path: string; protected?: boolean }> })
      .items.map(item => `${item.key}${item.path}${item.protected ? ' HttpOnly' : ''}`).sort()
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.title)')).toBe('Cookie rows fixture')
    expect(await cookies()).toEqual(['pref/', 'pref/app', 'sid/ HttpOnly', 'sid/app'])
    await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
    await appWindow.getByRole('button', { name: 'Site storage for 127.0.0.1', exact: true }).click()
    const panel = appWindow.getByRole('dialog', { name: 'Site storage · 127.0.0.1', exact: true })
    await panel.getByRole('button', { name: 'Cookies', exact: true }).click()
    await expect(panel.locator('.site-storage-item')).toHaveCount(4)
    // Both pref rows are named "Delete pref"; the filter leaves the /app one.
    await panel.getByRole('searchbox', { name: 'Filter site storage', exact: true }).fill('pref app')
    await expect(panel.locator('.site-storage-item')).toHaveCount(1)
    await panel.getByRole('button', { name: 'Delete pref', exact: true }).click()
    await expect.poll(cookies).toEqual(['pref/', 'sid/ HttpOnly', 'sid/app'])
    await panel.getByRole('searchbox', { name: 'Filter site storage', exact: true }).fill('')
    await expect(panel.locator('.site-storage-item')).toHaveCount(3)
    // Clear asks natively with Cancel as the button Enter presses; choosing Cancel keeps every cookie.
    let asked = await answerConfirmations(electronApp, 'cancel')
    await panel.getByRole('button', { name: 'Clear cookies', exact: true }).click()
    await expect.poll(asked).toEqual([expect.objectContaining({ buttons: ['Cancel', 'OK'], defaultId: 0, cancelId: 0 })])
    expect(await cookies()).toEqual(['pref/', 'sid/ HttpOnly', 'sid/app'])
    asked = await answerConfirmations(electronApp, 'ok')
    await panel.getByRole('button', { name: 'Clear cookies', exact: true }).click()
    await expect.poll(asked).toHaveLength(1)
    await expect.poll(cookies).toEqual(['sid/ HttpOnly'])
    await expect(panel.locator('.site-storage-item')).toHaveCount(1)
  } finally {
    await closeFixtureServer(server)
  }
})

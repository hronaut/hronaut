import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('clears global history while preserving workspace storage and retained records', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<title>History fixture</title><script>localStorage.setItem("proof", "retained")</script>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  const url = `${origin}/history`
  try {
    const state = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`) as { activeTabId: string }
    await expect.poll(() => appWindow.evaluate('window.hronautHistory.list()')).toMatchObject([{ url }])
    await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      await page.session.cookies.set({ url, name: 'proof', value: 'retained' })
    }, url)
    await appWindow.evaluate(`window.hronautBookmarks.add(${JSON.stringify(url)}, 'Retained bookmark')`)
    await appWindow.evaluate(`window.hronautPermissions.set(${JSON.stringify(origin)}, 'notifications', 'deny')`)
    await expect.poll(() => appWindow.evaluate(`window.hronautBrowsingData.siteSummary(${JSON.stringify(url)}, ${JSON.stringify(state.activeTabId)})`)).toMatchObject({ cookieCount: 1, historyEntries: 1 })
    expect(await appWindow.evaluate(`window.hronautBrowsingData.siteSummary(${JSON.stringify(url)}).catch(error => error.message)`)).toContain('Tab ID is required')
    await appWindow.keyboard.press('Control+Shift+Delete')
    const dialog = appWindow.getByRole('dialog', { name: 'Settings' })
    await expect(dialog.getByRole('heading', { name: 'Global history', exact: true })).toBeVisible()
    await expect(dialog.getByRole('checkbox')).toHaveCount(1)
    await expect(dialog.getByText('Global history & legacy data')).toHaveCount(0)
    appWindow.once('dialog', confirmation => { void confirmation.accept() })
    await dialog.getByRole('button', { name: `Clear history for ${origin}` }).click()
    await expect.poll(() => appWindow.evaluate('window.hronautBrowsingData.summary()')).toMatchObject({ historyEntries: 0, bookmarkCount: 1, permissionDecisionCount: 1 })
    expect(await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      return { cookies: (await page.session.cookies.get({})).map(cookie => cookie.value), local: await page.executeJavaScript('localStorage.getItem("proof")') }
    }, url)).toEqual({ cookies: ['retained'], local: 'retained' })
    expect(await appWindow.evaluate('window.hronautBrowsingData.clear({ history: false, cookiesAndSiteData: true, cache: true }).catch(error => error.message)')).toContain('Invalid history clearing options')
    await dialog.getByRole('button', { name: 'Close settings' }).click()
    await appWindow.getByRole('button', { name: 'Site controls for 127.0.0.1' }).click()
    await expect(appWindow.getByRole('dialog', { name: '127.0.0.1' }).getByRole('button', { name: 'Site storage', exact: true })).toBeVisible()
  } finally { await closeFixtureServer(server) }
})

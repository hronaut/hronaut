import { createServer } from 'node:http'
import { expect, test } from './fixtures.js'

test('summarizes and selectively clears browsing data without removing retained profile data', async ({
  appWindow,
  electronApp
}) => {
  const requests: string[] = []
  const cachedAsset = Buffer.alloc(256 * 1024, 0x61)
  const server = createServer((request, response) => {
    requests.push(request.url ?? '/')
    if (request.url === '/asset.bin') {
      response.writeHead(200, {
        'cache-control': 'public, max-age=3600',
        'content-length': String(cachedAsset.length),
        'content-type': 'application/octet-stream'
      })
      response.end(cachedAsset)
      return
    }
    response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Privacy data fixture</title><main>Persistent data</main><script>
      localStorage.setItem('hronaut-privacy-fixture', 'stored');
      fetch('/asset.bin').then((response) => response.arrayBuffer()).then(() => document.body.dataset.cached = 'true');
    </script>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Privacy fixture did not expose a port')
    const origin = `http://127.0.0.1:${address.port}`
    const otherOrigin = `http://localhost:${address.port}`
    const url = `${origin}/privacy`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronautHistory.list()')).toEqual([
      expect.objectContaining({ url, title: 'Privacy data fixture' })
    ])
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.executeJavaScript('document.body.dataset.cached')
    }, url)).toBe('true')
    await electronApp.evaluate(({ session }, cookieUrl) => session.fromPartition('persist:hronaut').cookies.set({
      url: cookieUrl,
      name: 'hronaut-privacy-fixture',
      value: 'private',
      expirationDate: Date.now() / 1_000 + 3_600
    }), origin)
    await electronApp.evaluate(({ session }, cookieUrl) => session.fromPartition('persist:hronaut').cookies.set({
      url: `${cookieUrl}/admin`,
      name: 'hronaut-path-scoped-fixture',
      value: 'private-admin',
      path: '/admin',
      expirationDate: Date.now() / 1_000 + 3_600
    }), origin)
    await electronApp.evaluate(({ session }, cookieUrl) => session.fromPartition('persist:hronaut').cookies.set({
      url: cookieUrl,
      name: 'hronaut-other-site-fixture',
      value: 'retained',
      expirationDate: Date.now() / 1_000 + 3_600
    }), otherOrigin)
    await appWindow.evaluate(`window.hronautBookmarks.add(${JSON.stringify(url)}, 'Retained privacy bookmark')`)
    await appWindow.evaluate(`window.hronautPermissions.set(${JSON.stringify(origin)}, 'notifications', 'deny')`)

    await expect.poll(() => appWindow.evaluate(`window.hronautBrowsingData.siteSummary(${JSON.stringify(url)})`)).toMatchObject({
      origin,
      cookieCount: 2,
      historyEntries: 1,
      historyVisits: 1
    })
    expect(await appWindow.evaluate("window.hronautBrowsingData.siteSummary('file:///tmp/not-a-site').then(() => '').catch((error) => error.message)"))
      .toContain('valid HTTP or HTTPS')

    await appWindow.getByRole('button', { name: 'Site controls for 127.0.0.1' }).click()
    const siteControls = appWindow.getByRole('dialog', { name: '127.0.0.1' })
    await expect(siteControls).toBeVisible()
    await expect(siteControls).toContainText(origin)
    await expect(siteControls.getByLabel('2 cookies available to this address')).toBeVisible()
    await expect(siteControls.getByLabel('1 history page and 1 visit')).toBeVisible()
    const siteNotificationPermission = siteControls.getByRole('combobox', {
      name: `Notifications permission for ${origin}`
    })
    await expect(siteNotificationPermission).toHaveValue('deny')
    await siteNotificationPermission.selectOption('allow')
    await expect.poll(() => appWindow.evaluate('window.hronautPermissions.list()')).toEqual([
      expect.objectContaining({ origin, permission: 'notifications', decision: 'allow' })
    ])
    await siteControls.getByRole('button', { name: `Reset Notifications permission for ${origin}` }).click()
    await expect(siteControls.getByText('Using defaults')).toBeVisible()
    await appWindow.evaluate(`window.hronautPermissions.set(${JSON.stringify(origin)}, 'notifications', 'deny')`)
    await siteControls.getByRole('button', { name: 'All site settings' }).click()
    let dialog = appWindow.getByRole('dialog', { name: 'Settings' })
    await expect(dialog.getByRole('heading', { name: 'Site permissions' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Close settings' }).click()
    await appWindow.getByRole('button', { name: 'Site controls for 127.0.0.1' }).click()
    await appWindow.getByRole('dialog', { name: '127.0.0.1' }).getByRole('button', { name: 'Clear data for this website' }).click()

    await expect.poll(() => appWindow.evaluate('window.hronautBrowsingData.summary()')).toMatchObject({
      cookieCount: expect.any(Number),
      historyEntries: 1,
      historyVisits: 1,
      bookmarkCount: 1,
      permissionDecisionCount: 1
    })
    const beforeSummary = await appWindow.evaluate('window.hronautBrowsingData.summary()') as { cookieCount: number }
    expect(beforeSummary.cookieCount).toBeGreaterThanOrEqual(3)
    await expect.poll(() => appWindow.evaluate('window.hronautBrowsingData.summary().then((summary) => summary.cacheBytes)')).toBeGreaterThan(0)
    const requestCountBeforeClear = requests.length

    dialog = appWindow.getByRole('dialog', { name: 'Settings' })
    const dialogHeight = (await dialog.boundingBox())!.height
    await expect(dialog.getByRole('heading', { name: 'Privacy & browsing data' })).toBeVisible()
    await expect(dialog.getByRole('searchbox', { name: 'Search websites' })).toHaveValue(origin)
    await appWindow.evaluate('window.hronaut.openHome()')
    await expect(dialog.getByRole('searchbox', { name: 'Search websites' })).toHaveValue(origin)
    await expect(dialog.getByRole('heading', { name: 'Privacy & browsing data' })).toBeVisible()
    await expect.poll(async () => (await dialog.boundingBox())!.height).toBe(dialogHeight)
    await expect(dialog).toContainText('2 cookies')
    await expect(dialog).toContainText('1 history page · 1 visit')
    await expect(dialog).toContainText('1 bookmark kept')
    await expect(dialog.getByRole('checkbox', { name: /^History/ })).toBeChecked()
    await expect(dialog.getByRole('checkbox', { name: /^Cookies & site data/ })).not.toBeChecked()
    await expect(dialog.getByRole('checkbox', { name: /^Cached files/ })).toBeChecked()
    await dialog.getByRole('checkbox', { name: /^Cookies & site data/ }).check()
    await expect(dialog.getByRole('button', { name: /Clear all websites/ })).toBeVisible()
    appWindow.once('dialog', (confirmation) => {
      expect(confirmation.message()).toContain(`for ${origin}`)
      expect(confirmation.message()).toContain('Related subdomains may share cookies')
      expect(confirmation.message()).toContain('Bookmarks, saved passwords, site permissions')
      void confirmation.accept()
    })
    await dialog.getByRole('button', { name: `Clear selected data for ${origin}` }).click()
    await expect(dialog.getByText(`Selected data was cleared for ${origin}. Open pages were left in place.`)).toBeVisible()

    await expect.poll(() => appWindow.evaluate('window.hronautBrowsingData.summary()')).toMatchObject({
      cookieCount: 1,
      historyEntries: 0,
      historyVisits: 0,
      bookmarkCount: 1,
      permissionDecisionCount: 1
    })
    expect(await electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.executeJavaScript(`fetch('/asset.bin').then((response) => response.arrayBuffer()).then((body) => body.byteLength)`)
    }, url)).toBe(cachedAsset.length)
    await expect.poll(() => requests.length).toBe(requestCountBeforeClear + 1)
    expect(await appWindow.evaluate('window.hronautBookmarks.list()')).toEqual([
      expect.objectContaining({ url, title: 'Retained privacy bookmark' })
    ])
    expect(await appWindow.evaluate('window.hronautPermissions.list()')).toEqual([
      expect.objectContaining({ origin, permission: 'notifications', decision: 'deny' })
    ])
    await expect(dialog.getByRole('radio')).toHaveCount(0)
    await expect(dialog).toContainText('Bookmarks (1)')
    await expect.poll(async () => (await dialog.boundingBox())!.height).toBe(dialogHeight)
    expect(await appWindow.evaluate('window.hronautMcp.getState()')).toMatchObject({ paused: false })
    await appWindow.evaluate('window.hronautBrowsingData.clear({ history: false, cookiesAndSiteData: true, cache: false })')
    await expect.poll(() => appWindow.evaluate('window.hronautBrowsingData.summary().then((summary) => summary.cookieCount)')).toBe(0)
    await appWindow.evaluate('window.hronautMcp.setPaused(true)')
    await appWindow.evaluate('window.hronautBrowsingData.clear({ history: false, cookiesAndSiteData: false, cache: true })')
    expect(await appWindow.evaluate('window.hronautMcp.getState()')).toMatchObject({ paused: true })
    await appWindow.evaluate('window.hronautMcp.setPaused(false)')
    expect(await appWindow.evaluate(`window.hronautBrowsingData.clear({ history: false, cookiesAndSiteData: false, cache: false })
      .then(() => '')
      .catch((error) => error.message)`)).toContain('Select at least one type')
    expect(requests).toHaveLength(requestCountBeforeClear + 1)
    expect(await electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.executeJavaScript(`localStorage.getItem('hronaut-privacy-fixture')`)
    }, url)).toBeNull()
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

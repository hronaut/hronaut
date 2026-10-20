import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('lists the page’s requests when Network opens from Request conditions or docks back from its window', async ({
  appWindow,
  electronApp
}) => {
  // Only the Page tools button read the requests, so Network opened from Request conditions said no requests were
  // captured yet, and docked back from its window it kept the list it had before.
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/data')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{}')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Network opens</title><h1>Network opens</h1><script>fetch("/data?first")</script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    const tabId = await appWindow.evaluate(`window.hronaut.newTab({ url: 'http://127.0.0.1:${port}/', active: true }).then((state) => state.activeTabId)`) as string
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) =>
      state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.title
    )`)).toBe('Network opens')
    const fetchFromPage = (path: string) => electronApp.evaluate(async ({ webContents }, url) => {
      await webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Network opens')!
        .executeJavaScript(`fetch(${JSON.stringify(url)}).then((response) => response.text())`)
    }, path)
    await fetchFromPage('/data?second')

    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    await appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('button', { name: /^Request conditions/ }).click()
    const panel = appWindow.getByRole('dialog', { name: 'Network', exact: true })
    const rows = panel.getByRole('listbox', { name: 'Network requests' }).getByRole('option')
    await expect(rows.filter({ hasText: 'data?second' })).toHaveCount(1)

    const detachedPagePromise = electronApp.waitForEvent('window')
    await panel.getByRole('combobox', { name: 'Dock network monitor' }).selectOption('window')
    const detachedPage = await detachedPagePromise
    await detachedPage.waitForLoadState('domcontentloaded')
    await expect(detachedPage.getByRole('dialog', { name: 'Network', exact: true })).toBeVisible()
    await expect(panel).toBeHidden()
    await fetchFromPage('/data?while-detached')

    const detachedClosed = detachedPage.waitForEvent('close')
    await detachedPage.evaluate(`setTimeout(() => {
      const select = document.querySelector('select[aria-label="Dock network monitor"]')
      if (!(select instanceof HTMLSelectElement)) throw new Error('Missing Network dock selector')
      select.value = 'right'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }, 0)`)
    await detachedClosed
    await expect(panel).toBeVisible()
    await expect(rows.filter({ hasText: 'data?while-detached' })).toHaveCount(1)
  } finally {
    await closeFixtureServer(server)
  }
})

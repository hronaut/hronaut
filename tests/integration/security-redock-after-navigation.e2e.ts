import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('Connection security shows the page it docks back to after the tab navigated while it was in its window', async ({ appWindow, electronApp }) => {
  // The main window kept the panel open, hidden, while it showed in its own window. The navigation cleared its report there,
  // so docked back it showed only its header, with nothing to run.
  const server = createServer((request, response) => {
    const page = request.url === '/second' ? 'Second' : 'First'
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<title>${page} security</title><p>${page}</p>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  const securityPage = () => electronApp.windows().find(page => page.url().includes('hronautPanel=security'))
  const activeTitle = () => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    .then(state => state.tabs.find(tab => tab.active)?.title))
  try {
    const tabId = await appWindow.evaluate(async url => (await (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true })).activeTabId, `${origin}/first`)
    if (!tabId) throw new Error('Missing fixture tab')
    await expect.poll(activeTitle).toBe('First security')
    await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
    await appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('button', { name: /^Security:/ }).click()
    const security = appWindow.getByRole('dialog', { name: 'Connection security', exact: true })
    await expect(security.getByRole('heading', { name: 'Connection', exact: true })).toBeVisible()

    await security.getByRole('combobox', { name: 'Dock Connection security' }).selectOption('window')
    // Wait for the panel window by its address: tooltips and website views are reported as pages too.
    await expect.poll(() => Boolean(securityPage())).toBe(true)
    const securityWindow = securityPage()!
    await securityWindow.waitForLoadState('domcontentloaded')
    await expect(securityWindow.getByRole('dialog', { name: 'Connection security', exact: true })).toBeVisible()
    await expect(security).toBeHidden()
    await appWindow.evaluate(({ tabId, url }) => (window as unknown as { hronaut: HronautApi }).hronaut.navigate({ tabId, url }), { tabId, url: `${origin}/second` })
    await expect.poll(activeTitle).toBe('Second security')

    const securityWindowClosed = securityWindow.waitForEvent('close')
    await securityWindow.evaluate(`setTimeout(() => {
      const select = document.querySelector('select[aria-label="Dock Connection security"]')
      if (!(select instanceof HTMLSelectElement)) throw new Error('Missing Connection security dock selector')
      select.value = 'right'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }, 0)`)
    await securityWindowClosed
    await expect(security).toBeVisible()
    await expect(security.getByRole('heading', { name: 'Connection', exact: true })).toBeVisible()
  } finally {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) if (window.getTitle() !== 'Hronaut') window.close()
    }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})

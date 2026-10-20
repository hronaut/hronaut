import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('Environment shows the tab’s settings as they are now when it docks back from its window', async ({ appWindow, electronApp }) => {
  // The main window kept the panel open, hidden, while it showed in its own window, so docked back it showed the draft it
  // had before it left, and Apply put back the settings applied in the window meanwhile.
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Environment redock</title><p>Fixture</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  const environmentPage = () => electronApp.windows().find(page => page.url().includes('hronautPanel=environment'))
  const colorScheme = (tabId: string) => appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    .then(state => state.tabs.find(tab => tab.id === tabId)?.emulation?.colorScheme ?? 'auto'), tabId)
  try {
    const tabId = await appWindow.evaluate(async url => (await (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true })).activeTabId, url)
    if (!tabId) throw new Error('Missing fixture tab')
    await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
      .then(state => state.tabs.find(tab => tab.active)?.title))).toBe('Environment redock')
    await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
    await appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('button', { name: /^Environment:/ }).click()
    const environment = appWindow.getByRole('dialog', { name: 'Environment', exact: true })
    await expect(environment.getByLabel('Color scheme', { exact: true })).toHaveValue('auto')

    await environment.getByRole('combobox', { name: 'Dock Environment' }).selectOption('window')
    // Wait for the panel window by its address: tooltips and website views are reported as pages too.
    await expect.poll(() => Boolean(environmentPage())).toBe(true)
    const environmentWindow = environmentPage()!
    await environmentWindow.waitForLoadState('domcontentloaded')
    const detached = environmentWindow.getByRole('dialog', { name: 'Environment', exact: true })
    await expect(detached).toBeVisible()
    await expect(environment).toBeHidden()
    // The window loads the tab's settings again once its state arrives, which can replace a choice made before then.
    await expect(async () => {
      await detached.getByLabel('Color scheme', { exact: true }).selectOption('dark')
      await detached.getByRole('button', { name: 'Apply', exact: true }).click()
      await expect.poll(() => colorScheme(tabId), { timeout: 2_000 }).toBe('dark')
    }).toPass()

    const environmentWindowClosed = environmentWindow.waitForEvent('close')
    await environmentWindow.evaluate(`setTimeout(() => {
      const select = document.querySelector('select[aria-label="Dock Environment"]')
      if (!(select instanceof HTMLSelectElement)) throw new Error('Missing Environment dock selector')
      select.value = 'right'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }, 0)`)
    await environmentWindowClosed
    await expect(environment).toBeVisible()
    await expect(environment.getByLabel('Color scheme', { exact: true })).toHaveValue('dark')
    await environment.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(environment.getByText('Environment applied', { exact: true })).toBeVisible()
    expect(await colorScheme(tabId)).toBe('dark')
  } finally {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) if (window.getTitle() !== 'Hronaut') window.close()
    }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})

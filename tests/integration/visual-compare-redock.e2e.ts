import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('Visual compare shows the tab’s comparison as it is now when it docks back from its window', async ({ appWindow, electronApp }) => {
  // The main window kept the panel open, hidden, while it showed in its own window, so docked back it showed what it had
  // before it left: no baseline, although one was set meanwhile.
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Visual redock</title><main><h1>Fixture</h1></main>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  const visualPage = () => electronApp.windows().find(page => page.url().includes('hronautPanel=visual-compare'))
  try {
    const tabId = await appWindow.evaluate(async url => (await (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true })).activeTabId, url)
    if (!tabId) throw new Error('Missing fixture tab')
    await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
      .then(state => state.tabs.find(tab => tab.active)?.title))).toBe('Visual redock')
    await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
    await appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('button', { name: /Visual compare:/ }).click()
    const visual = appWindow.getByRole('dialog', { name: 'Visual compare', exact: true })
    await expect(visual.getByText('Capture the page before a change', { exact: true })).toBeVisible()

    await visual.getByRole('combobox', { name: 'Dock Visual compare' }).selectOption('window')
    // Wait for the panel window by its address: tooltips and website views are reported as pages too.
    await expect.poll(() => Boolean(visualPage())).toBe(true)
    const visualWindow = visualPage()!
    await visualWindow.waitForLoadState('domcontentloaded')
    await expect(visualWindow.getByRole('dialog', { name: 'Visual compare', exact: true })).toBeVisible()
    await expect(visual).toBeHidden()
    const baseline = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.visualCompare({
      tabId, action: 'set-baseline', settleMs: 0
    }).then(report => report.status), tabId)
    expect(baseline).toBe('baseline')

    const visualWindowClosed = visualWindow.waitForEvent('close')
    await visualWindow.evaluate(`setTimeout(() => {
      const select = document.querySelector('select[aria-label="Dock Visual compare"]')
      if (!(select instanceof HTMLSelectElement)) throw new Error('Missing Visual compare dock selector')
      select.value = 'right'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }, 0)`)
    await visualWindowClosed
    await expect(visual).toBeVisible()
    await expect(visual.getByText('Baseline ready', { exact: true })).toBeVisible()
    await expect(visual.getByText('Capture the page before a change', { exact: true })).toBeHidden()
  } finally {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) if (window.getTitle() !== 'Hronaut') window.close()
    }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})

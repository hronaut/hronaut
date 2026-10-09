import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HronautApi, HronautHistoryApi } from '../../src/shared/types.js'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('sorts retained visits within History filters and preserves focus through a real background revisit', async ({ profileDirectory, mcpPort }, testInfo) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Reference beta</title><h1>Synthetic history sorting</h1>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    const entries = ([
      ['other', 'Other page', 'https://other.example/', 1, 0],
      ['beta', 'Reference beta', `${origin}/beta`, 1, 60_000],
      ['alpha', 'Reference alpha', `${origin}/alpha`, 2, 120_000],
      ['old', 'Reference old', `${origin}/old`, 20, 10 * 86_400_000]
    ] as const).map(([id, title, url, visitCount, age]) => ({ id, title, url, visitCount, visitedAt: new Date(Date.now() - age).toISOString() }))
    const path = join(profileDirectory, 'history.json')
    await writeFile(path, JSON.stringify({ version: 1, entries }))
    let instance = await launchHronaut(profileDirectory, mcpPort)
    try {
      const page = instance.window
      await page.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url: 'about:blank', active: true }))
      const before = await page.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
      await page.getByRole('button', { name: 'Browsing history', exact: true }).click()
      let panel = page.getByRole('dialog', { name: 'Browsing history' })
      const titles = () => panel.locator('.history-copy strong')
      let sort = panel.getByRole('combobox', { name: 'Sort history' })
      await expect(sort).toHaveValue('recent')
      await expect(titles()).toHaveText(entries.map(entry => entry.title))
      await sort.focus()
      await sort.press('ArrowDown')
      await expect(sort).toHaveValue('visits')
      await expect(sort).toBeFocused()
      await expect(titles()).toHaveText(['Reference old', 'Reference alpha', 'Other page', 'Reference beta'])
      await panel.getByRole('combobox', { name: 'Date range' }).selectOption('last7Days')
      await panel.getByRole('button', { name: 'Filter history by origin of Reference beta', exact: true }).click()
      await panel.getByRole('searchbox').fill('Reference')
      await expect(titles()).toHaveText(['Reference alpha', 'Reference beta'])
      await panel.getByRole('searchbox').fill('127.0.0.1   REFERENCE')
      await expect(titles()).toHaveText(['Reference alpha', 'Reference beta'])
      await expect(panel.getByRole('searchbox')).toBeFocused()
      await expect(sort).toHaveValue('visits')
      await expect(panel.getByRole('combobox', { name: 'Date range' })).toHaveValue('last7Days')
      await panel.getByRole('searchbox').fill('old 127.0.0.1')
      await expect(panel.locator('.history-item')).toHaveCount(0)
      await panel.getByRole('searchbox').fill('Other other.example')
      await expect(panel.locator('.history-item')).toHaveCount(0)
      await panel.getByRole('searchbox').fill('missing')
      await expect(panel.locator('.history-item')).toHaveCount(0)
      await expect(sort).toBeEnabled()
      await panel.getByRole('searchbox').fill('127.0.0.1 Reference')
      expect(await page.evaluate(() => (window as unknown as { hronautHistory: HronautHistoryApi }).hronautHistory.list())).toEqual(entries)
      expect(JSON.parse(await readFile(path, 'utf8')).entries).toEqual(entries)
      const background = panel.getByRole('button', { name: 'Open Reference beta in background tab' })
      await background.focus()
      await background.press('Enter')
      await expect.poll(async () => {
        const visits = await page.evaluate(() => (window as unknown as { hronautHistory: HronautHistoryApi }).hronautHistory.list())
        return visits.find(entry => entry.id === 'beta')?.visitCount
      }).toBe(2)
      await expect(titles()).toHaveText(['Reference beta', 'Reference alpha'])
      await expect(background).toBeFocused()
      await expect(background).toHaveAttribute('aria-disabled', 'false')
      expect((await page.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())).activeTabId).toBe(before.activeTabId)
      await panel.getByRole('button', { name: 'Close browsing history' }).click()
      await page.getByRole('button', { name: 'Browsing history', exact: true }).click()
      await expect(sort).toHaveValue('visits')
      await expect(titles()).toHaveText(['Reference beta', 'Reference alpha'])
      await instance.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 760))
      await expect(sort).toBeInViewport({ ratio: 1 })
      expect(await panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      await testInfo.attach('history-most-visited-compact', { body: await panel.screenshot(), contentType: 'image/png' })
      await closeHronaut(instance.app)
      instance = await launchHronaut(profileDirectory, mcpPort)
      await instance.window.getByRole('button', { name: 'Browsing history', exact: true }).click()
      panel = instance.window.getByRole('dialog', { name: 'Browsing history' })
      sort = panel.getByRole('combobox', { name: 'Sort history' })
      await expect(sort).toHaveValue('recent')
      const persisted = await instance.window.evaluate(() => (window as unknown as { hronautHistory: HronautHistoryApi }).hronautHistory.list())
      await expect(titles()).toHaveText(persisted.map(entry => entry.title))
    } finally { await closeHronaut(instance.app) }
  } finally { await closeFixtureServer(server) }
})

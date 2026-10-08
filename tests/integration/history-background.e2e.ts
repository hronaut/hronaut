import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('opens History results in the background while retaining the working page and filtered History', async ({ profileDirectory, mcpPort }, testInfo) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>${request.url === '/current' ? 'Current fixture' : 'Background fixture'}</title><h1>Synthetic History fixture</h1>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    await writeFile(join(profileDirectory, 'history.json'), JSON.stringify({ version: 1, entries: [{
      id: 'background-history', title: 'Background fixture', url: `${origin}/background`,
      visitedAt: new Date().toISOString(), visitCount: 1
    }] }))
    const instance = await launchHronaut(profileDirectory, mcpPort)
    try {
      const page = instance.window
      const state = () => page.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
      await page.evaluate(async url => {
        await (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true })
      }, `${origin}/current`)
      await expect.poll(async () => (await state()).tabs.find(tab => tab.url === `${origin}/current`)?.loading).toBe(false)
      const before = await state()
      await page.getByRole('button', { name: 'Browsing history', exact: true }).click()
      const panel = page.getByRole('dialog', { name: 'Browsing history' })
      const search = panel.getByRole('searchbox')
      const dateRange = panel.getByRole('combobox', { name: 'Date range' })
      await search.fill('Background')
      await dateRange.selectOption('last7Days')
      const button = panel.getByRole('button', { name: 'Open Background fixture in background tab' })
      await expect(button).toBeVisible()
      await button.focus()
      for (const [index, key] of ['Enter', 'Space'].entries()) {
        await button.press(key)
        await expect.poll(async () => (await state()).tabs.filter(tab => tab.url === `${origin}/background` && !tab.loading).length).toBe(index + 1)
        const after = await state()
        expect(after.tabs.length).toBe(before.tabs.length + index + 1)
        expect(after.activeTabId).toBe(before.activeTabId)
        expect(after.tabs.find(tab => tab.id === before.activeTabId)?.url).toBe(`${origin}/current`)
        await expect(panel).toBeVisible()
        await expect(search).toHaveValue('Background')
        await expect(dateRange).toHaveValue('last7Days')
        await expect(button).toBeFocused()
        await expect(button).toHaveAttribute('aria-disabled', 'false')
      }
      await instance.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 760))
      await expect(button).toBeInViewport({ ratio: 1 })
      expect(await panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      await testInfo.attach('history-background-compact', { body: await panel.screenshot(), contentType: 'image/png' })
      await panel.getByRole('button', { name: 'Close browsing history' }).click()
      await page.getByRole('button', { name: 'Browsing history', exact: true }).click()
      await expect(search).toHaveValue('Background')
      await expect(dateRange).toHaveValue('last7Days')
      await panel.getByTitle(`${origin}/background`, { exact: true }).click()
      await expect(panel).toHaveCount(0)
      await expect.poll(async () => (await state()).activeTabId).not.toBe(before.activeTabId)
      await expect.poll(async () => (await state()).tabs.filter(tab => tab.url === `${origin}/background`).length).toBe(3)
    } finally { await closeHronaut(instance.app) }
  } finally {
    await closeFixtureServer(server)
  }
})

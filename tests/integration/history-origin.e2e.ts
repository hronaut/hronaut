import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HronautHistoryApi } from '../../src/shared/types.js'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('filters exact history origins with search/date, keyboard access and unchanged saved visits', async ({ profileDirectory, mcpPort }, testInfo) => {
  const entries = [
    ['exact', 'Docs guide', 'https://docs.example/guide'],
    ['old', 'Docs old', 'https://docs.example/old'],
    ['query', 'Query mention', 'https://other.example/?next=https://docs.example/'],
    ['suffix', 'Suffix mention', 'https://docs.example.evil.test/'],
    ['port', 'Different port', 'https://docs.example:8443/'],
    ['scheme', 'Different scheme', 'http://docs.example/'],
    ['title', 'docs.example title mention', 'https://other.example/title']
  ].map(([id, title, url]) => ({
    id, title, url, visitCount: 1,
    visitedAt: new Date(Date.now() - (id === 'old' ? 10 * 86_400_000 : 0)).toISOString()
  }))
  entries.sort((left, right) => right.visitedAt.localeCompare(left.visitedAt) || left.title.localeCompare(right.title))
  const path = join(profileDirectory, 'history.json')
  await writeFile(path, JSON.stringify({ version: 1, entries }))
  let instance = await launchHronaut(profileDirectory, mcpPort)
  try {
    const window = instance.window
    await window.getByRole('button', { name: 'Browsing history', exact: true }).click()
    const panel = window.getByRole('dialog', { name: 'Browsing history' })
    const search = panel.getByRole('searchbox')
    await search.fill('docs.example')
    await expect(panel.locator('.history-item')).toHaveCount(7)
    const action = panel.getByRole('button', { name: 'Filter history by origin of Docs guide', exact: true })
    await action.focus()
    await action.press('Enter')
    await expect(panel.locator('.history-item')).toHaveCount(2)
    await expect(action).toBeFocused()
    await expect(panel.locator('.history-origin-filter')).toContainText('Origin: https://docs.example')
    await panel.getByRole('combobox', { name: 'Date range' }).selectOption('today')
    await expect(panel.locator('.history-item')).toHaveCount(1)
    await panel.getByRole('button', { name: 'Close browsing history' }).click()
    await window.getByRole('button', { name: 'Browsing history', exact: true }).click()
    await expect(panel.locator('.history-item')).toHaveCount(1)
    await expect(search).toHaveValue('docs.example')
    await expect(panel.getByRole('combobox', { name: 'Date range' })).toHaveValue('today')
    await search.fill('no match')
    await expect(panel).toContainText('No matching visits')
    const clear = panel.getByRole('button', { name: 'Clear origin filter' })
    await clear.focus()
    await clear.press('Enter')
    await expect(search).toBeFocused()
    await expect(panel.locator('.history-origin-filter')).toHaveCount(0)
    await search.fill('')
    await expect(panel.locator('.history-item')).toHaveCount(6)
    await action.click()
    await instance.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 760))
    await expect(action).toBeInViewport({ ratio: 1 })
    await expect(clear).toBeInViewport({ ratio: 1 })
    expect(await panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await testInfo.attach('history-origin-compact', { body: await panel.screenshot(), contentType: 'image/png' })
    expect(await window.evaluate(() => (window as unknown as { hronautHistory: HronautHistoryApi }).hronautHistory.list())).toEqual(entries)
    expect(JSON.parse(await readFile(path, 'utf8')).entries).toEqual(entries)
    await closeHronaut(instance.app)
    instance = await launchHronaut(profileDirectory, mcpPort)
    await instance.window.getByRole('button', { name: 'Browsing history', exact: true }).click()
    const fresh = instance.window.getByRole('dialog', { name: 'Browsing history' })
    await expect(fresh.locator('.history-origin-filter')).toHaveCount(0)
    await expect(fresh.locator('.history-item')).toHaveCount(7)
  } finally { await closeHronaut(instance.app) }
})

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HronautHistoryApi } from '../../src/shared/types.js'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('filters synthetic history by local dates without changing saved visits', async ({ profileDirectory, mcpPort }, testInfo) => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const entries = [0, 1, 6, 7].map(daysAgo => {
    const date = new Date(today)
    date.setDate(date.getDate() - daysAgo)
    return {
      id: `day-${daysAgo}`, title: `Reference day ${daysAgo}`,
      url: `https://example.test/day-${daysAgo}`, visitedAt: date.toISOString(), visitCount: 3
    }
  })
  const path = join(profileDirectory, 'history.json')
  await writeFile(path, JSON.stringify({ version: 1, entries }))
  let instance = await launchHronaut(profileDirectory, mcpPort)
  try {
    let window = instance.window
    await window.getByRole('button', { name: 'Browsing history', exact: true }).click()
    let panel = window.getByRole('dialog', { name: 'Browsing history' })
    let select = panel.getByRole('combobox', { name: 'Date range' })
    await expect(panel.locator('.history-item')).toHaveCount(4)
    await select.focus()
    await select.press('Home')
    await select.press('ArrowDown')
    await select.press('Enter')
    await expect(select).toHaveValue('today')
    await expect(select).toBeFocused()
    await expect(panel.locator('.history-item')).toHaveCount(1)
    await select.selectOption('last7Days')
    await expect(panel.locator('.history-item')).toHaveCount(3)
    await panel.getByRole('searchbox').fill('day-6')
    await expect(panel.locator('.history-item')).toHaveCount(1)
    await select.selectOption('today')
    await expect(panel).toContainText('No matching visits')
    await select.selectOption('last7Days')
    await panel.getByRole('button', { name: 'Close browsing history' }).click()
    await window.getByRole('button', { name: 'Browsing history', exact: true }).click()
    await expect(select).toHaveValue('last7Days')
    await expect(panel.getByRole('searchbox')).toHaveValue('day-6')
    await expect(panel.locator('.history-item')).toHaveCount(1)
    await panel.getByRole('searchbox').fill('')
    await instance.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 760))
    await expect(select).toBeInViewport({ ratio: 1 })
    expect(await panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await testInfo.attach('history-dates-compact', { body: await panel.screenshot(), contentType: 'image/png' })
    expect(await window.evaluate(() => (window as unknown as { hronautHistory: HronautHistoryApi }).hronautHistory.list())).toEqual(entries)
    expect(JSON.parse(await readFile(path, 'utf8')).entries).toEqual(entries)
    await closeHronaut(instance.app)
    instance = await launchHronaut(profileDirectory, mcpPort)
    window = instance.window
    await window.getByRole('button', { name: 'Browsing history', exact: true }).click()
    panel = window.getByRole('dialog', { name: 'Browsing history' })
    select = panel.getByRole('combobox', { name: 'Date range' })
    await expect(select).toHaveValue('all')
    await expect(panel.locator('.history-item')).toHaveCount(4)
  } finally { await closeHronaut(instance.app) }
})

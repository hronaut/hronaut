import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

for (const focusedControl of ['row', 'search', 'filter']) {
  test(`preserves History ${focusedControl} focus when Today rolls past midnight`, async ({ profileDirectory, mcpPort }, testInfo) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const beforeMidnight = new Date(today)
    beforeMidnight.setHours(23, 59, 59, 0)
    await writeFile(join(profileDirectory, 'history.json'), JSON.stringify({ version: 1, entries: [{
      id: 'synthetic-today', title: 'Synthetic history focus', url: 'https://example.test/focus',
      visitedAt: today.toISOString(), visitCount: 1
    }] }))
    const instance = await launchHronaut(profileDirectory, mcpPort)
    try {
      const page = instance.window
      await page.clock.install({ time: new Date(beforeMidnight.getTime() - 60_000) })
      await page.clock.pauseAt(beforeMidnight)
      await page.getByRole('button', { name: 'Browsing history', exact: true }).click()
      const panel = page.getByRole('dialog', { name: 'Browsing history' })
      await panel.getByRole('combobox', { name: 'Date range' }).selectOption('today')
      const control = focusedControl === 'row'
        ? panel.getByRole('button', { name: 'Bookmark Synthetic history focus', exact: true })
        : focusedControl === 'search' ? panel.getByRole('searchbox')
          : panel.getByRole('combobox', { name: 'Date range' })
      await control.focus()
      await expect(control).toBeFocused()
      await page.clock.fastForward(1000)
      await expect(panel.locator('.history-item')).toHaveCount(0)
      await expect(panel).toBeVisible()
      const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, class: document.activeElement?.className }))
      await testInfo.attach('focus-after-midnight', { body: JSON.stringify(focus), contentType: 'application/json' })
      await expect(focusedControl === 'row' ? panel.getByRole('searchbox') : control).toBeFocused()
    } finally { await closeHronaut(instance.app) }
  })
}

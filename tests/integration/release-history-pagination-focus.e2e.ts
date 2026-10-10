import { expect, test } from './fixtures.js'
import type { AppReleaseHistoryPage } from '../../src/shared/types.js'

type HistoryPaginationProbe = typeof globalThis & {
  historyPaginationProbe?: { release(): void }
}

for (const outcome of ['more', 'last', 'error', 'moved'] as const) {
  test(`keeps release pagination keyboard ownership after ${outcome}`, async ({ appWindow, electronApp }, testInfo) => {
    const focusState = () => appWindow.evaluate(() => ({
      tag: document.activeElement?.tagName,
      label: document.activeElement?.getAttribute('aria-label'),
      footerFocused: document.activeElement?.closest('.whats-new-footer') !== null,
      documentFocused: document.hasFocus()
    }))
    const page = (number: number, version: string, hasMore: boolean): AppReleaseHistoryPage => ({
      page: number, hasMore, releases: [{ version, title: `Hronaut ${version}`,
        publishedAt: '2026-09-12T12:00:00Z', notes: '### Fixed\n\n- Pagination fixture.',
        url: `https://github.com/hronaut/hronaut/releases/tag/v${version}` }]
    })
    await electronApp.evaluate(({ ipcMain }, fixture) => {
      let release!: () => void
      const pending = new Promise<void>(resolve => { release = resolve })
      ;(globalThis as HistoryPaginationProbe).historyPaginationProbe = { release }
      ipcMain.removeHandler('updates:get-release-history')
      ipcMain.handle('updates:get-release-history', async (_event, number: number) => {
        if (number === 1) return fixture.first
        await pending
        if (fixture.fail) throw new Error('Synthetic older-release failure')
        return fixture.second
      })
    }, { first: page(1, '2.29.0', true), second: page(2, '2.28.0', outcome === 'more'), fail: outcome === 'error' })
    try {
      await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = appWindow.getByRole('tabpanel', { name: 'Settings', exact: true })
      await settings.getByRole('button', { name: /Updates Automatic checks/ }).click()
      await settings.getByRole('button', { name: "View what's new" }).click()
      const history = appWindow.getByRole('dialog', { name: "What's new", exact: true })
      await expect(history.getByRole('article')).toHaveCount(1)
      const older = history.getByRole('button', { name: 'Load older releases', exact: true })
      await older.focus()
      await appWindow.keyboard.press('Enter')
      await expect(history.getByRole('button', { name: 'Loading…', exact: true })).toBeDisabled()
      const pendingFocus = await focusState()
      const close = history.getByRole('button', { name: "Close What's new", exact: true })
      if (outcome === 'moved') await close.focus()
      await electronApp.evaluate(() => { (globalThis as HistoryPaginationProbe).historyPaginationProbe?.release() })
      await expect(history).toHaveAttribute('aria-busy', 'false')
      if (outcome === 'error') await expect(history.getByRole('alert')).toContainText('Synthetic older-release failure')
      else await expect(history.getByRole('article')).toHaveCount(2)
      await testInfo.attach('pagination-focus-state', {
        body: JSON.stringify({ pending: pendingFocus, completed: await focusState() }), contentType: 'application/json'
      })
      const expected = outcome === 'moved' ? close
        : outcome === 'last' ? history.getByRole('button', { name: 'View all on GitHub', exact: true }) : older
      await expect(expected).toBeFocused()
    } finally {
      await electronApp.evaluate(({ ipcMain }) => {
        (globalThis as HistoryPaginationProbe).historyPaginationProbe?.release()
        delete (globalThis as HistoryPaginationProbe).historyPaginationProbe
        ipcMain.removeHandler('updates:get-release-history')
      })
    }
  })
}

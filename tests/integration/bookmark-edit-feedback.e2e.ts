import type { HronautBookmarksApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

type Gate = { calls: number; release(): void; restore(): void }
type Scope = typeof globalThis & { __bookmarkEditFeedback?: Gate }

for (const action of ['title', 'address'] as const) {
  for (const scenario of ['filter-failure', 'escape-failure', 'unchanged-failure', 'filter-success'] as const) {
    test(`bookmark ${action} ${scenario} keeps save feedback with its editor`, async ({ appWindow, electronApp }) => {
      const initial = await appWindow.evaluate(async () => {
        const api = (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks
        const bookmarks = await api.add('https://example.test/original', 'Original bookmark')
        const collections = await api.collections!.create('Empty collection')
        return { bookmark: bookmarks[0]!, collection: collections.collections[0]!.id }
      })
      const channel = action === 'title' ? 'bookmarks:rename' : 'bookmarks:update-destination'
      await electronApp.evaluate(({ ipcMain }, { channel, succeed }) => {
        type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
        const original = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers.get(channel)!
        let release!: () => void
        const barrier = new Promise<void>(resolve => { release = resolve })
        const gate: Gate = { calls: 0, release, restore: () => {
          release()
          ipcMain.removeHandler(channel)
          ipcMain.handle(channel, original)
        } }
        ;(globalThis as Scope).__bookmarkEditFeedback = gate
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, async (event, ...args) => {
          gate.calls++
          await barrier
          if (!succeed) throw new Error('Bookmark edit failed for feedback regression')
          return original(event, ...args)
        })
      }, { channel, succeed: scenario === 'filter-success' })
      try {
        await appWindow.getByRole('button', { name: 'New tab', exact: true }).click()
        await appWindow.getByRole('button', { name: 'Bookmarks', exact: true }).click()
        const panel = appWindow.getByRole('dialog', { name: 'Bookmarks' })
        const editName = action === 'title' ? 'Rename Original bookmark' : 'Edit address for Original bookmark'
        await panel.getByRole('button', { name: editName, exact: true }).click()
        const input = panel.getByRole('textbox', { name: editName, exact: true })
        const submitted = action === 'title' ? 'Submitted title' : 'https://example.test/submitted'
        await input.fill(submitted)
        await input.press('Enter')
        await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__bookmarkEditFeedback!.calls)).toBe(1)
        await expect(input).toBeDisabled()
        const filter = panel.getByRole('combobox', { name: 'Filter bookmarks by collection' })
        const search = panel.getByRole('searchbox')
        const dismissed = scenario !== 'unchanged-failure'
        if (scenario.startsWith('filter-')) {
          await expect(filter).toBeEnabled()
          await filter.selectOption(`c:${initial.collection}`)
          await expect(panel.locator('.bookmark-item')).toHaveCount(0)
        } else if (scenario === 'escape-failure') {
          await search.focus()
          await search.press('Escape')
        }
        if (dismissed) {
          await expect(panel).toBeVisible()
          await expect(input).toHaveCount(0)
          await search.focus()
        }
        await electronApp.evaluate(() => (globalThis as Scope).__bookmarkEditFeedback!.release())
        await expect(panel.getByRole('button', { name: 'New collection', exact: true })).toBeEnabled()
        if (dismissed) {
          await expect(panel.getByRole('alert')).toHaveCount(0)
          await expect(input).toHaveCount(0)
          await expect(search).toBeFocused()
          await expect(filter).toHaveValue(scenario.startsWith('filter-') ? `c:${initial.collection}` : 'all')
        } else {
          await expect(panel.getByRole('alert')).toContainText('Bookmark edit failed for feedback regression')
          await expect(input).toHaveValue(submitted)
          await expect(input).toBeEnabled()
        }
        const saved = await appWindow.evaluate(() => (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks.list())
        if (scenario === 'filter-success') {
          expect(saved).toHaveLength(1)
          expect(saved[0]).toMatchObject({ id: initial.bookmark.id, createdAt: initial.bookmark.createdAt,
            title: action === 'title' ? submitted : initial.bookmark.title,
            url: action === 'address' ? submitted : initial.bookmark.url })
          await filter.selectOption('all')
          await expect(panel.locator('.bookmark-item')).toContainText(submitted)
        } else expect(saved).toEqual([initial.bookmark])
        expect(await electronApp.evaluate(() => (globalThis as Scope).__bookmarkEditFeedback!.calls)).toBe(1)
      } finally {
        await electronApp.evaluate(() => { (globalThis as Scope).__bookmarkEditFeedback?.restore(); delete (globalThis as Scope).__bookmarkEditFeedback }).catch(() => undefined)
      }
    })
  }
}

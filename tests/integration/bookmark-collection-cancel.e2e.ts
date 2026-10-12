import type { HronautBookmarksApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

type Gate = { calls: number; release(): void; restore(): void }
type Scope = typeof globalThis & { __collectionCancel?: Gate }

for (const action of ['create', 'rename'] as const) {
  for (const scenario of ['cancel-failure', 'unchanged-failure', 'cancel-success'] as const) {
    test(`collection ${action} ${scenario} keeps feedback with its editor`, async ({ appWindow, electronApp }) => {
      const initial = await appWindow.evaluate(async () => {
        const api = (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks
        await api.add('https://example.test/reference', 'Reference bookmark')
        return api.collections!.create('Original collection')
      })
      const id = initial.collections[0]!.id
      const channel = `bookmark-collections:${action}`
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
        ;(globalThis as Scope).__collectionCancel = gate
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, async (event, ...args) => {
          gate.calls++
          await barrier
          if (!succeed) throw new Error('Collection save failed for cancellation regression')
          return original(event, ...args)
        })
      }, { channel, succeed: scenario === 'cancel-success' })
      try {
        await appWindow.getByRole('button', { name: 'New tab', exact: true }).click()
        await appWindow.getByRole('button', { name: 'Bookmarks', exact: true }).click()
        const panel = appWindow.getByRole('dialog', { name: 'Bookmarks' })
        const filter = panel.getByRole('combobox', { name: 'Filter bookmarks by collection' })
        await filter.selectOption(`c:${id}`)
        await panel.getByRole('button', { name: action === 'create' ? 'New collection' : 'Rename collection', exact: true }).click()
        const input = panel.getByRole('textbox', { name: 'Collection name', exact: true })
        await input.fill('Submitted collection')
        await panel.getByRole('button', { name: 'Save collection', exact: true }).click()
        await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__collectionCancel!.calls)).toBe(1)
        await expect(input).toBeDisabled()
        const cancelled = scenario !== 'unchanged-failure'
        const search = panel.getByRole('searchbox')
        if (cancelled) {
          const cancel = panel.getByRole('button', { name: 'Cancel collection edit', exact: true })
          await expect(cancel).toBeEnabled()
          await cancel.click()
          await expect(input).toHaveCount(0)
          await search.focus()
        }
        await electronApp.evaluate(() => (globalThis as Scope).__collectionCancel!.release())
        await expect(panel.getByRole('button', { name: 'New collection', exact: true })).toBeEnabled()
        if (cancelled) {
          await expect(panel.getByRole('alert')).toHaveCount(0)
          await expect(input).toHaveCount(0)
          await expect(search).toBeFocused()
          await expect(filter).toHaveValue(`c:${id}`)
        } else {
          await expect(panel.getByRole('alert')).toContainText('Collection save failed for cancellation regression')
          await expect(input).toHaveValue('Submitted collection')
          await expect(input).toBeEnabled()
        }
        const saved = await appWindow.evaluate(() => (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks.collections!.list())
        if (scenario === 'cancel-success') {
          expect(saved.collections).toHaveLength(action === 'create' ? 2 : 1)
          expect(saved.collections.some(collection => collection.name === 'Submitted collection')).toBe(true)
          await expect(filter.locator('option', { hasText: 'Submitted collection' })).toHaveCount(1)
        } else expect(saved).toEqual(initial)
        expect(await electronApp.evaluate(() => (globalThis as Scope).__collectionCancel!.calls)).toBe(1)
      } finally {
        await electronApp.evaluate(() => { (globalThis as Scope).__collectionCancel?.restore(); delete (globalThis as Scope).__collectionCancel }).catch(() => undefined)
      }
    })
  }
}

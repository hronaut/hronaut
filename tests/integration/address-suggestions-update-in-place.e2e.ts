import { expect, test } from './fixtures.js'
import type { HronautApi, HronautBookmarksApi } from '../../src/shared/types.js'

type TestWindow = Window & { hronaut: HronautApi; hronautBookmarks: HronautBookmarksApi }
type ViewChanges = { hidden: number; collapsed: number }

// The address bar's suggestions hid and shrank to a line each time they changed while shown, as they do when a visit or
// a bookmark is saved meanwhile, until the view had drawn the new ones: the list blinked, and a click on it in that
// moment went nowhere. Chrome's list updates in place.
test('address suggestions stay on screen while they update, as in Chrome', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(async () => {
    await (window as unknown as TestWindow).hronautBookmarks.add('http://127.0.0.1:9/first', 'Saved first')
    await (window as unknown as TestWindow).hronaut.newTab({ active: true })
  })
  const rows = () => electronApp.evaluate(async ({ webContents }) => {
    const overlay = webContents.getAllWebContents().find(contents => contents.getURL().includes('address-overlay.html'))
    return await overlay?.executeJavaScript("[...document.querySelectorAll('[role=option]')].map(row => row.querySelector('strong').textContent)") as string[] | undefined
  })
  // The suggestions view as the window shows it, or null while it is not shown.
  const shown = () => electronApp.evaluate(({ BrowserWindow, webContents }) => {
    const overlay = webContents.getAllWebContents().find(contents => contents.getURL().includes('address-overlay.html'))
    const main = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Hronaut')
    const view = main?.contentView.children.find(child => (child as unknown as { webContents?: { id: number } }).webContents?.id === overlay?.id)
    return view?.getVisible() ? view.getBounds().height : null
  })
  const address = appWindow.getByRole('combobox', { name: 'Address' })
  await address.fill('Saved')
  await expect.poll(rows).toEqual(['Saved first'])
  await expect.poll(shown).toBeGreaterThan(1)
  const firstHeight = (await shown())!

  // Counts every time the view is hidden or shrunk to a line from here on.
  await electronApp.evaluate(({ BrowserWindow, webContents }) => {
    const overlay = webContents.getAllWebContents().find(contents => contents.getURL().includes('address-overlay.html'))
    const main = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Hronaut')
    const view = main!.contentView.children.find(child => (child as unknown as { webContents?: { id: number } }).webContents?.id === overlay?.id)!
    const changes: ViewChanges = { hidden: 0, collapsed: 0 }
    ;(globalThis as typeof globalThis & { __hronautSuggestionView?: { view: Electron.View; changes: ViewChanges } }).__hronautSuggestionView = { view, changes }
    const setVisible = view.setVisible.bind(view)
    const setBounds = view.setBounds.bind(view)
    view.setVisible = (visible: boolean) => {
      if (!visible) changes.hidden += 1
      setVisible(visible)
    }
    view.setBounds = (bounds: Electron.Rectangle) => {
      if (bounds.height <= 1) changes.collapsed += 1
      setBounds(bounds)
    }
  })
  try {
    await appWindow.evaluate(async () => (window as unknown as TestWindow).hronautBookmarks.add('http://127.0.0.1:9/second', 'Saved second'))
    await expect.poll(rows).toEqual(expect.arrayContaining(['Saved first', 'Saved second']))
    // It grows to the new rows once they are drawn, without being hidden or shrunk on the way.
    await expect.poll(shown).toBeGreaterThan(firstHeight)
    expect(await electronApp.evaluate(() => (globalThis as typeof globalThis & { __hronautSuggestionView?: { changes: ViewChanges } }).__hronautSuggestionView!.changes))
      .toEqual({ hidden: 0, collapsed: 0 })
    await expect(address).toBeFocused()
  } finally {
    await electronApp.evaluate(() => {
      const scope = globalThis as typeof globalThis & { __hronautSuggestionView?: { view: Electron.View } }
      const view = scope.__hronautSuggestionView?.view
      if (view) {
        Reflect.deleteProperty(view, 'setVisible')
        Reflect.deleteProperty(view, 'setBounds')
      }
      delete scope.__hronautSuggestionView
    }).catch(() => undefined)
  }
})

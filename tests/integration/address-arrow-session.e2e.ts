import type { HronautApi, HronautBookmarksApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('keeps keyboard-reopened suggestions visible after a delayed old dismissal', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(async () => {
    const api = window as unknown as { hronaut: HronautApi; hronautBookmarks: HronautBookmarksApi }
    await api.hronautBookmarks.add('https://saved.example/', 'Saved session fixture')
    await api.hronaut.newTab({ active: true })
  })
  await electronApp.evaluate(({ ipcMain }) => {
    const probe = {
      sessionId: 0,
      listener: (_event: unknown, request: { sessionId: number }) => { probe.sessionId = request.sessionId }
    }
    const target = globalThis as unknown as { addressReopenProbe: typeof probe }
    target.addressReopenProbe = probe
    ipcMain.on('address-overlay:show', probe.listener)
  })
  await appWindow.evaluate(() => {
    const target = window as unknown as {
      hronautAddressOverlay: { onDismissed(listener: (id: number) => void): () => void }
      addressReopenCleanup?: () => void
    }
    target.addressReopenCleanup = target.hronautAddressOverlay.onDismissed(id => {
      document.documentElement.dataset.addressDismissedSession = String(id)
    })
  })
  try {
    const address = appWindow.getByRole('combobox', { name: 'Address', exact: true })
    await address.fill('Saved session fixture')
    await expect(address).toHaveAttribute('aria-expanded', 'true')
    const session = () => electronApp.evaluate(() => (globalThis as unknown as { addressReopenProbe: { sessionId: number } }).addressReopenProbe.sessionId)
    await expect.poll(session).toBeGreaterThan(0)
    const previous = await session()
    await address.press('Escape')
    await expect(address).toHaveAttribute('aria-expanded', 'false')
    await address.press('ArrowDown')
    await expect(address).toHaveAttribute('aria-expanded', 'true')
    await electronApp.evaluate(({ BrowserWindow }, id) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send('address-overlay:dismissed', id)
    }, previous)
    await expect(appWindow.locator('html')).toHaveAttribute('data-address-dismissed-session', String(previous))
    await expect(address).toHaveAttribute('aria-expanded', 'true')
    await expect(address).toBeFocused()
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow, webContents }) => {
      const overlay = webContents.getAllWebContents().find(contents => contents.getURL().includes('address-overlay.html'))
      return BrowserWindow.getAllWindows()[0]!.contentView.children.find(view => (
        view as unknown as { webContents?: { id: number } }
      ).webContents?.id === overlay?.id)?.getVisible() ?? false
    })).toBe(true)
    const state = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
    expect(state.tabs.find(tab => tab.active)?.url).toBe('about:blank')
  } finally {
    await appWindow.evaluate(() => {
      const target = window as unknown as { addressReopenCleanup?: () => void }
      target.addressReopenCleanup?.()
      delete target.addressReopenCleanup
      delete document.documentElement.dataset.addressDismissedSession
    })
    await electronApp.evaluate(({ ipcMain }) => {
      const target = globalThis as unknown as { addressReopenProbe?: { listener: (_event: unknown, request: { sessionId: number }) => void } }
      if (target.addressReopenProbe) ipcMain.removeListener('address-overlay:show', target.addressReopenProbe.listener)
      delete target.addressReopenProbe
    })
  }
})

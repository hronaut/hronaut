import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('reads tab state through the retained handle when its native view getter is unavailable', async ({ appWindow, electronApp }) => {
  const title = 'Navigation history teardown fixture'
  const url = `data:text/html,<title>${title}</title><main>History fixture</main>`
  const opened = await appWindow.evaluate(async (url) => (window as typeof window & { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
  await expect.poll(() => appWindow.evaluate(async (id) => {
    const state = await (window as typeof window & { hronaut: HronautApi }).hronaut.getState()
    return state.tabs.find(tab => tab.id === id)?.title
  }, opened.activeTabId)).toBe(title)

  try {
    await electronApp.evaluate(({ BrowserWindow, WebContentsView }, title) => {
      const view = BrowserWindow.getAllWindows().flatMap(window => window.contentView.children)
        .find((candidate): candidate is InstanceType<typeof WebContentsView> => (
          candidate instanceof WebContentsView && candidate.webContents.getTitle() === title
        ))
      if (!view) throw new Error('History fixture view was not found')
      const original = Object.getOwnPropertyDescriptor(view, 'webContents')
      const mainGlobal = globalThis as typeof globalThis & { __hronautRestoreHistoryView?: () => void }
      mainGlobal.__hronautRestoreHistoryView = () => {
        if (original) Object.defineProperty(view, 'webContents', original)
        else Reflect.deleteProperty(view, 'webContents')
      }
      Object.defineProperty(view, 'webContents', {
        configurable: true,
        get: () => { throw new Error('Native view getter unavailable during teardown') }
      })
    }, title)

    const tab = await appWindow.evaluate(async (id) => {
      const state = await (window as typeof window & { hronaut: HronautApi }).hronaut.getState()
      return state.tabs.find(tab => tab.id === id)
    }, opened.activeTabId)
    expect(tab?.title).toBe(title)
    expect(tab?.url).toBe(url)
    expect(tab?.canGoBack).toBe(false)
    expect(tab?.canGoForward).toBe(false)
  } finally {
    await electronApp.evaluate(() => {
      const mainGlobal = globalThis as typeof globalThis & { __hronautRestoreHistoryView?: () => void }
      mainGlobal.__hronautRestoreHistoryView?.()
      delete mainGlobal.__hronautRestoreHistoryView
    })
  }
})

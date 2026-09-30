import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('releases cookie authority listeners after destroyed tabs close and reinstalls them on reopening', async ({ appWindow, electronApp }) => {
  const created = await appWindow.evaluate(() => (window as typeof window & { hronaut: HronautApi }).hronaut.createWorkspace({
    name: 'Cookie listener cleanup', storage: 'scratch'
  }))
  const firstId = created.activeTabId!
  const workspaceId = created.tabs.find(tab => tab.id === firstId)!.mcpGroupId!
  const url = 'data:text/html,<title>Cookie listener cleanup fixture</title>'
  try {
    await appWindow.evaluate(async ({ firstId, workspaceId, url }) => {
      const api = (window as typeof window & { hronaut: HronautApi }).hronaut
      await api.navigate({ tabId: firstId, url })
      await api.newTab({ mcpGroupId: workspaceId, url: 'about:blank', active: true })
    }, { firstId, workspaceId, url })
    await expect.poll(() => appWindow.evaluate(async (id) => (
      await (window as typeof window & { hronaut: HronautApi }).hronaut.getState()
    ).tabs.find(tab => tab.id === id)?.title, firstId)).toBe('Cookie listener cleanup fixture')
    await electronApp.evaluate(({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!contents) throw new Error('Cookie cleanup fixture not found')
      const mainGlobal = globalThis as typeof globalThis & { __cookieCleanupSession?: Electron.Session; __cookieCleanupContents?: Electron.WebContents }
      mainGlobal.__cookieCleanupSession = contents.session
      mainGlobal.__cookieCleanupContents = contents
    }, url)
    const listenerCount = () => electronApp.evaluate(() => (
      globalThis as typeof globalThis & { __cookieCleanupSession?: Electron.Session }
    ).__cookieCleanupSession!.cookies.listenerCount('changed'))
    expect(await listenerCount()).toBe(1)
    const afterFirstClose = await appWindow.evaluate(id => (
      window as typeof window & { hronaut: HronautApi }
    ).hronaut.closeTab(id), firstId)
    expect(await electronApp.evaluate(() => (globalThis as typeof globalThis & {
      __cookieCleanupContents?: Electron.WebContents
    }).__cookieCleanupContents!.isDestroyed())).toBe(true)
    expect(await listenerCount()).toBe(1)
    const remainingId = afterFirstClose.tabs.find(tab => tab.mcpGroupId === workspaceId)!.id
    await appWindow.evaluate(id => (window as typeof window & { hronaut: HronautApi }).hronaut.closeTab(id), remainingId)
    expect(await listenerCount()).toBe(0)
    await appWindow.evaluate(id => (window as typeof window & { hronaut: HronautApi }).hronaut.newTab({
      mcpGroupId: id, url: 'about:blank', active: true
    }), workspaceId)
    expect(await listenerCount()).toBe(1)
  } finally {
    await electronApp.evaluate(() => {
      Reflect.deleteProperty(globalThis, '__cookieCleanupSession')
      Reflect.deleteProperty(globalThis, '__cookieCleanupContents')
    })
    await appWindow.evaluate(id => (window as typeof window & { hronaut: HronautApi }).hronaut.closeWorkspace(id), workspaceId)
  }
})

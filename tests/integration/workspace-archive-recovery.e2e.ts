import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('retains an archived workspace when replacement Home creation fails and allows retry without losing browser data', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Archive recovery fixture</title><main>Recoverable browser data</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fixture server unavailable')
    const url = `http://127.0.0.1:${address.port}/retained`
    const created = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.createWorkspace({ name: 'Recoverable archive', storage: 'scratch' }))
    const workspace = created.mcpTabGroups.find(group => group.name === 'Recoverable archive')!
    const sourceTabId = created.activeTabId!
    await appWindow.evaluate(input => (window as unknown as { hronaut: HronautApi }).hronaut.navigate(input), { tabId: sourceTabId, url })
    await expect.poll(() => electronApp.evaluate(({ webContents }, target) => webContents.getAllWebContents().some(contents => contents.getURL() === target), url)).toBe(true)
    await electronApp.evaluate(async ({ webContents }, target) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === target)!
      await contents.executeJavaScript("localStorage.setItem('recoverable', 'preserved')")
      await contents.session.cookies.set({ url: target, name: 'recoverable-cookie', value: 'preserved', path: '/', httpOnly: true })
    }, url)
    for (const tab of created.tabs.filter(tab => tab.id !== sourceTabId)) {
      await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), tab.id)
    }
    expect((await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())).tabs).toHaveLength(1)
    await electronApp.evaluate(({ WebContentsView }) => {
      const original = WebContentsView.prototype.setBounds
      WebContentsView.prototype.setBounds = function (bounds) {
        if (!this.webContents.getURL()) {
          WebContentsView.prototype.setBounds = original
          ;(globalThis as typeof globalThis & { __archiveHomeFailureInjected?: boolean }).__archiveHomeFailureInjected = true
          throw new Error('simulated replacement Home view failure')
        }
        return original.call(this, bounds)
      }
    })
    // A display fallback failure must not turn a successfully archived profile
    // into unreachable storage, or force the user to retry an already-done archive.
    const archived = await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.saveAndCloseTabGroup(id), workspace.id)
    expect(await electronApp.evaluate(() => (globalThis as typeof globalThis & { __archiveHomeFailureInjected?: boolean }).__archiveHomeFailureInjected)).toBe(true)
    expect(archived.savedTabGroups.find(group => group.id === workspace.id)).toMatchObject({ name: 'Recoverable archive', tabs: [{ url }] })
    expect(archived.mcpTabGroups.some(group => group.id === workspace.id)).toBe(false)
    const recoveredHome = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.openHome())
    expect(recoveredHome.tabs.some(tab => tab.url === 'hronaut://home/')).toBe(true)
    expect(recoveredHome.savedTabGroups.some(group => group.id === workspace.id)).toBe(true)
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.restoreSavedTabGroup(id), workspace.id)
    await expect.poll(() => electronApp.evaluate(({ webContents }, target) => webContents.getAllWebContents().some(contents => contents.getURL() === target), url)).toBe(true)
    expect(await electronApp.evaluate(async ({ webContents }, target) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === target)!
      return { value: await contents.executeJavaScript("localStorage.getItem('recoverable')"), cookies: (await contents.session.cookies.get({})).map(cookie => `${cookie.name}=${cookie.value}`) }
    }, url)).toEqual({ value: 'preserved', cookies: ['recoverable-cookie=preserved'] })
  } finally {
    await closeFixtureServer(server)
  }
})

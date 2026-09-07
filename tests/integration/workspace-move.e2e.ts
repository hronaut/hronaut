import { createServer } from 'node:http'
import type { BrowserState, BrowserWorkspaceStorageTransferResult, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('copies arbitrary workspace data and moves archived source cookies and localStorage without removing unrelated destination data', async ({ appWindow, electronApp }) => {
  let storageProbeRequests = 0
  const server = createServer((request, response) => {
    if (request.url?.includes('hronaut-workspace-storage')) storageProbeRequests += 1
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Workspace Move fixture</title><main>Storage transfer fixture</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fixture server address unavailable')
    const origin = `http://127.0.0.1:${address.port}`
    const sourceUrl = `${origin}/source`
    const targetUrl = `${origin}/target`
    const sourceState = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.createWorkspace({ name: 'Move source', storage: 'scratch' })) as BrowserState
    const sourceId = sourceState.mcpTabGroups.find(group => group.name === 'Move source')!.id
    await appWindow.evaluate(input => (window as unknown as { hronaut: HronautApi }).hronaut.navigate(input), { tabId: sourceState.activeTabId!, url: sourceUrl })
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL() === url), sourceUrl)).toBe(true)
    await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      await contents.executeJavaScript("localStorage.setItem('shared', 'source'); localStorage.setItem('source-only', 'keep-copy')")
      await contents.session.cookies.set({ url, name: 'same-name', value: 'source-root', path: '/', httpOnly: true })
      await contents.session.cookies.set({ url, name: 'same-name', value: 'source-private', path: '/private', httpOnly: true })
    }, sourceUrl)
    const targetState = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.createWorkspace({ name: 'Move target', storage: 'scratch' })) as BrowserState
    const targetId = targetState.mcpTabGroups.find(group => group.name === 'Move target')!.id
    await appWindow.evaluate(input => (window as unknown as { hronaut: HronautApi }).hronaut.navigate(input), { tabId: targetState.activeTabId!, url: targetUrl })
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL() === url), targetUrl)).toBe(true)
    await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      await contents.executeJavaScript("localStorage.setItem('shared', 'old-target'); localStorage.setItem('target-only', 'preserve')")
      await contents.session.cookies.set({ url, name: 'same-name', value: 'target-unrelated', path: '/unrelated', httpOnly: true })
    }, targetUrl)
    const transferOptions = { sourceWorkspaceId: sourceId, targetWorkspaceId: targetId, origins: [origin] }
    const copied = await appWindow.evaluate(input => (window as unknown as { hronaut: HronautApi }).hronaut.transferWorkspaceStorage({ ...input, mode: 'copy' }), transferOptions)
    expect(copied).toMatchObject({ mode: 'copy', cookieCount: 2, localStorageItemCount: 2 })
    expect(await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      return { cookies: (await contents.session.cookies.get({})).length, value: await contents.executeJavaScript("localStorage.getItem('shared')") }
    }, sourceUrl)).toEqual({ cookies: 2, value: 'source' })
    const activeMoveError = await appWindow.evaluate(input => (window as unknown as { hronaut: HronautApi }).hronaut.transferWorkspaceStorage({ ...input, mode: 'move' }).then(() => 'unexpected success', error => String(error.message)), transferOptions)
    expect(activeMoveError).toContain('Archive both workspaces')
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.saveAndCloseTabGroup(id), sourceId)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL() === url), sourceUrl)).toBe(false)
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.saveAndCloseTabGroup(id), targetId)
    const moved = await appWindow.evaluate(input => (window as unknown as { hronaut: HronautApi }).hronaut.transferWorkspaceStorage({ ...input, mode: 'move' }), transferOptions) as BrowserWorkspaceStorageTransferResult
    expect(moved).toMatchObject({ mode: 'move', cleanupStatus: 'complete', removedCookieCount: 2, removedLocalStorageItemCount: 2, retainedCookieCount: 0, retainedLocalStorageItemCount: 0 })
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.restoreSavedTabGroup(id), targetId)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL() === url), targetUrl)).toBe(true)
    const destination = await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      return {
        cookies: (await contents.session.cookies.get({})).map(cookie => `${cookie.path}:${cookie.value}`).sort(),
        storage: await contents.executeJavaScript('Object.fromEntries(Object.entries(localStorage))')
      }
    }, targetUrl)
    expect(destination).toEqual({ cookies: ['/:source-root', '/private:source-private', '/unrelated:target-unrelated'], storage: { shared: 'source', 'source-only': 'keep-copy', 'target-only': 'preserve' } })
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.restoreSavedTabGroup(id), sourceId)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL() === url), sourceUrl)).toBe(true)
    const restoredSource = await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      return { cookies: await contents.session.cookies.get({}), storage: await contents.executeJavaScript('Object.fromEntries(Object.entries(localStorage))') }
    }, sourceUrl)
    expect(restoredSource).toEqual({ cookies: [], storage: {} })
    expect(storageProbeRequests).toBe(0)
  } finally {
    await closeFixtureServer(server)
  }
})

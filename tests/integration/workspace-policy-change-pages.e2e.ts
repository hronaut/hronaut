import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** Two sites: the workspace keeps the first allowed and drops the second. The second can hold a page's response. */
async function sites() {
  const blockedRequests: string[] = []
  let releaseSlowPage: (() => void) | undefined
  let slowPageRequested!: () => void
  const slowPageReached = new Promise<void>((resolve) => { slowPageRequested = resolve })
  const page = (title: string, script = '') => `<!doctype html><title>${title}</title><input id="draft"><script>${script}</script>`
  const allowed = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(page('Allowed page'))
  })
  const blocked = createServer((request, response) => {
    blockedRequests.push(request.url ?? '')
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    if (request.url === '/slow-page') {
      releaseSlowPage = () => response.end(page('Slow page'))
      slowPageRequested()
      return
    }
    response.end(page(request.url === '/draft' ? 'Draft' : 'Blocked page', request.url === '/draft'
      ? "addEventListener('beforeunload', event => { event.preventDefault(); event.returnValue = '' })"
      : ''))
  })
  return {
    allowedOrigin: await listen(allowed),
    blockedOrigin: await listen(blocked),
    blockedRequests,
    slowPageReached,
    releaseSlowPage: () => releaseSlowPage?.(),
    close: async () => {
      releaseSlowPage?.()
      await Promise.all([closeFixtureServer(allowed), closeFixtureServer(blocked)])
    }
  }
}

/** Creates an unrestricted workspace with an allowed page and, in the background, a page of the other site. */
async function workspaceWithPages(appWindow: import('@playwright/test').Page, allowedUrl: string, blockedUrl: string) {
  const ids = await appWindow.evaluate(async ({ allowedUrl, blockedUrl }) => {
    const hronaut = (window as unknown as { hronaut: HronautApi }).hronaut
    const name = `Policy change ${Date.now()}`
    const created = await hronaut.createWorkspace({ name, storage: 'scratch' })
    const workspace = created.mcpTabGroups.find(group => group.name === name)!.id
    const allowed = (await hronaut.newTab({ url: allowedUrl, mcpGroupId: workspace, active: true })).activeTabId!
    const before = new Set((await hronaut.getState()).tabs.map(tab => tab.id))
    const after = await hronaut.newTab({ url: blockedUrl, mcpGroupId: workspace, active: false })
    const blocked = after.tabs.find(tab => !before.has(tab.id))!.id
    return { workspace, allowed, blocked }
  }, { allowedUrl, blockedUrl })
  await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    .then(state => state.tabs.every(tab => !tab.loading)))).toBe(true)
  return ids
}

function restrict(appWindow: import('@playwright/test').Page, workspace: string, allowedOrigin: string) {
  return appWindow.evaluate(({ workspace, allowedOrigin }) => (window as unknown as { hronaut: HronautApi }).hronaut
    .updateWorkspaceNavigationPolicy(workspace, { mode: 'restricted', rules: [allowedOrigin] }), { workspace, allowedOrigin })
}

function pagesShowing(electronApp: import('@playwright/test').ElectronApplication, url: string) {
  return electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().filter(contents => contents.getURL() === url).length, url)
}

test('restricting a workspace wakes a sleeping tab of a dropped site on a blank page, and the workspace still restores', async ({ appWindow, electronApp }) => {
  const site = await sites()
  try {
    const { workspace, blocked } = await workspaceWithPages(appWindow, `${site.allowedOrigin}/start`, `${site.blockedOrigin}/sleeping-page`)
    await appWindow.evaluate((tabId) => (window as unknown as { hronaut: HronautApi }).hronaut.setTabSleeping(tabId, true), blocked)
    const requestsBefore = site.blockedRequests.length

    const state = await restrict(appWindow, workspace, site.allowedOrigin)
    expect(state.tabs.find(tab => tab.id === blocked)).toMatchObject({ url: 'about:blank', sleeping: false })

    await appWindow.evaluate((tabId) => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(tabId), blocked)
    await appWindow.evaluate((tabId) => (window as unknown as { hronaut: HronautApi }).hronaut.reload(tabId), blocked)
    await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
      .then(state => state.tabs.every(tab => !tab.loading)))).toBe(true)
    expect(await pagesShowing(electronApp, `${site.blockedOrigin}/sleeping-page`)).toBe(0)
    expect(site.blockedRequests.length).toBe(requestsBefore)

    // The archive keeps the blank page, not the dropped site's address, so restoring it is not refused.
    await appWindow.evaluate((id) => (window as unknown as { hronaut: HronautApi }).hronaut.saveAndCloseTabGroup(id), workspace)
    const restored = await appWindow.evaluate((id) => (window as unknown as { hronaut: HronautApi }).hronaut.restoreSavedTabGroup(id), workspace)
    expect(restored.tabs.filter(tab => tab.mcpGroupId === workspace).map(tab => tab.url)).toContain('about:blank')
  } finally {
    await site.close()
  }
})

test('restricting a workspace stops a page of a dropped site that is still loading', async ({ appWindow, electronApp }) => {
  const site = await sites()
  try {
    const { workspace } = await workspaceWithPages(appWindow, `${site.allowedOrigin}/start`, `${site.blockedOrigin}/other`)
    await electronApp.evaluate(({ webContents }, { from, to }) => {
      void webContents.getAllWebContents().find(contents => contents.getURL() === from)!.executeJavaScript(`location.href = ${JSON.stringify(to)}`)
    }, { from: `${site.allowedOrigin}/start`, to: `${site.blockedOrigin}/slow-page` })
    await site.slowPageReached

    await restrict(appWindow, workspace, site.allowedOrigin)
    site.releaseSlowPage()

    // Wait for the allowed page to settle, then check the slow page never opened.
    await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
      .then(state => state.tabs.every(tab => !tab.loading)))).toBe(true)
    expect(await pagesShowing(electronApp, `${site.blockedOrigin}/slow-page`)).toBe(0)
  } finally {
    await site.close()
  }
})

test('restricting a workspace replaces a page of a dropped site even when it asks before leaving', async ({ appWindow, electronApp }) => {
  const site = await sites()
  try {
    const { workspace, blocked } = await workspaceWithPages(appWindow, `${site.allowedOrigin}/start`, `${site.blockedOrigin}/draft`)
    await appWindow.evaluate((tabId) => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(tabId), blocked)
    const draftUrl = `${site.blockedOrigin}/draft`
    // A page may ask before leaving only once the person has used it, so type into the draft first.
    await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      page.focus()
      await page.executeJavaScript("document.querySelector('#draft').focus()")
      page.sendInputEvent({ type: 'char', keyCode: 'x' })
    }, draftUrl)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .find(contents => contents.getURL() === url)?.executeJavaScript("document.querySelector('#draft').value"), draftUrl)).toBe('x')

    const state = await restrict(appWindow, workspace, site.allowedOrigin)

    expect(state.tabs.find(tab => tab.id === blocked)?.url).toBe('about:blank')
    expect(await pagesShowing(electronApp, draftUrl)).toBe(0)
  } finally {
    await site.close()
  }
})

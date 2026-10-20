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

/**
 * Two sites: the workspace keeps the first allowed and drops the second. The second can hold a page's response, and
 * both hold the responses for the paths a test lists until it releases them.
 */
async function sites() {
  const blockedRequests: string[] = []
  let releaseSlowPage: (() => void) | undefined
  let slowPageRequested!: () => void
  const slowPageReached = new Promise<void>((resolve) => { slowPageRequested = resolve })
  const page = (title: string, script = '') => `<!doctype html><title>${title}</title><input id="draft"><script>${script}</script>`
  const heldPaths = new Set<string>()
  const heldResponses: (() => void)[] = []
  const allowedRequests: string[] = []
  const allowed = createServer((request, response) => {
    allowedRequests.push(request.url ?? '')
    // No copy is kept, so waking a tab asks the site again.
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    if (heldPaths.has(request.url ?? '')) {
      heldResponses.push(() => response.end(page(`Allowed ${request.url}`)))
      return
    }
    response.end(page('Allowed page'))
  })
  const blocked = createServer((request, response) => {
    blockedRequests.push(request.url ?? '')
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    if (heldPaths.has(request.url ?? '')) {
      heldResponses.push(() => response.end(page(`Blocked ${request.url}`)))
      return
    }
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
    allowedRequests,
    hold: (...paths: string[]) => { for (const path of paths) heldPaths.add(path) },
    releaseHeld: () => {
      heldPaths.clear()
      for (const release of heldResponses.splice(0)) release()
    },
    close: async () => {
      releaseSlowPage?.()
      for (const release of heldResponses.splice(0)) release()
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

test('restricting a workspace lets allowed pages that are still opening or waking finish', async ({ appWindow, electronApp }) => {
  const site = await sites()
  try {
    const { workspace, allowed: opening, blocked: waking } = await workspaceWithPages(appWindow, `${site.allowedOrigin}/start`, `${site.allowedOrigin}/sleeper`)
    await appWindow.evaluate((tabId) => (window as unknown as { hronaut: HronautApi }).hronaut.setTabSleeping(tabId, true), waking)
    site.hold('/held-open', '/sleeper')
    await electronApp.evaluate(({ webContents }, { from, to }) => {
      void webContents.getAllWebContents().find(contents => contents.getURL() === from)!.executeJavaScript(`location.href = ${JSON.stringify(to)}`)
    }, { from: `${site.allowedOrigin}/start`, to: `${site.allowedOrigin}/held-open` })
    // Selecting the sleeping tab wakes it, which waits for the held page.
    await appWindow.evaluate((tabId) => { void (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(tabId) }, waking)
    await expect.poll(() => ['/held-open', '/sleeper'].every(path => site.allowedRequests.includes(path))).toBe(true)

    const restricting = restrict(appWindow, workspace, site.allowedOrigin)
    await expect.poll(() => appWindow.evaluate((id) => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
      .then(state => state.mcpTabGroups.find(group => group.id === id)?.navigationPolicy.mode), workspace)).toBe('restricted')
    site.releaseHeld()
    const state = await restricting

    // The page still opening used to be stopped, and the waking tab was checked on its sleeping placeholder,
    // blanked, and put back to sleep.
    expect(state.tabs.find(tab => tab.id === waking)).toMatchObject({ sleeping: false })
    await expect.poll(() => pagesShowing(electronApp, `${site.allowedOrigin}/held-open`)).toBe(1)
    await expect.poll(() => pagesShowing(electronApp, `${site.allowedOrigin}/sleeper`)).toBe(1)
    expect((await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()))
      .tabs.filter(tab => tab.id === opening || tab.id === waking).map(tab => tab.url).sort())
      .toEqual([`${site.allowedOrigin}/held-open`, `${site.allowedOrigin}/sleeper`])
    expect(await appWindow.evaluate((id) => (window as unknown as { hronaut: HronautApi }).hronaut.listWorkspaceNavigationAudit(id), workspace)).toEqual([])
  } finally {
    await site.close()
  }
})

test('restricting a workspace blanks a tab waking to a dropped site without waiting for that page', async ({ appWindow, electronApp }) => {
  const site = await sites()
  try {
    const { workspace, blocked } = await workspaceWithPages(appWindow, `${site.allowedOrigin}/start`, `${site.blockedOrigin}/wake-page`)
    await appWindow.evaluate((tabId) => (window as unknown as { hronaut: HronautApi }).hronaut.setTabSleeping(tabId, true), blocked)
    site.hold('/wake-page')
    // Selecting the sleeping tab wakes it, which waits for the held page.
    await appWindow.evaluate((tabId) => { void (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(tabId) }, blocked)
    await expect.poll(() => site.blockedRequests.filter(path => path === '/wake-page').length).toBe(2)

    // Saving the rules used to wait for the waking page, so it waited as long as the dropped site held its answer.
    const state = await restrict(appWindow, workspace, site.allowedOrigin)
    expect(state.tabs.find(tab => tab.id === blocked)).toMatchObject({ url: 'about:blank', sleeping: false })

    site.releaseHeld()
    await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
      .then(state => state.tabs.every(tab => !tab.loading)))).toBe(true)
    expect((await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()))
      .tabs.find(tab => tab.id === blocked)).toMatchObject({ url: 'about:blank', sleeping: false })
    expect(await pagesShowing(electronApp, `${site.blockedOrigin}/wake-page`)).toBe(0)
    expect(site.blockedRequests.filter(path => path === '/wake-page')).toHaveLength(2)
  } finally {
    await site.close()
  }
})

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// Chromium's Back skips a page that opened the next by script without the person's activation. A trace's snapshots run
// Playwright's scripts in every page with a user gesture, which would give the pages that activation.
test.use({ trace: 'off' })

type Hronaut = { hronaut: HronautApi }

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** A site whose /redirect page opens /next by script once it has loaded, as a sign-in hop does. */
function site(requests: string[]): Server {
  return createServer((request, response) => {
    requests.push(request.url ?? '')
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(request.url === '/redirect'
      ? '<!doctype html><title>Redirect</title><script>addEventListener(\'load\', () => setTimeout(() => { location.href = \'/next\' }, 200))</script>'
      : `<!doctype html><title>Page ${request.url}</title>`)
  })
}

// Back checked the workspace's policy for the page before only. When that page had opened the next by script, Chromium
// went past it to the one before, which the workspace no longer allowed, and loaded it.
test('Back never opens a page the workspace stopped allowing, past a page that opened the next by script', async ({ appWindow }) => {
  const allowedRequests: string[] = []
  const droppedRequests: string[] = []
  const allowedServer = site(allowedRequests)
  const droppedServer = site(droppedRequests)
  const allowed = await listen(allowedServer)
  const dropped = await listen(droppedServer)
  try {
    const { workspace, tabId } = await appWindow.evaluate(async (dropped) => {
      const hronaut = (window as unknown as Hronaut).hronaut
      const name = `History skip ${Date.now()}`
      const created = await hronaut.createWorkspace({ name, storage: 'scratch' })
      const workspace = created.mcpTabGroups.find(group => group.name === name)!.id
      const tabId = (await hronaut.newTab({ url: `${dropped}/`, mcpGroupId: workspace, active: true })).activeTabId!
      return { workspace, tabId }
    }, dropped)
    const tab = () => appWindow.evaluate(id => (window as unknown as Hronaut).hronaut.getState()
      .then(state => state.tabs.find(tab => tab.id === id)), tabId)
    await expect.poll(async () => { const shown = await tab(); return shown?.url === `${dropped}/` && !shown.loading }).toBe(true)
    await appWindow.evaluate(({ tabId, url }) => (window as unknown as Hronaut).hronaut.navigate({ tabId, url }), { tabId, url: `${allowed}/redirect` })
    await expect.poll(async () => { const shown = await tab(); return shown?.url === `${allowed}/next` && !shown.loading }).toBe(true)

    await appWindow.evaluate(({ workspace, allowed }) => (window as unknown as Hronaut).hronaut
      .updateWorkspaceNavigationPolicy(workspace, { mode: 'restricted', rules: [allowed] }), { workspace, allowed })
    droppedRequests.length = 0
    allowedRequests.length = 0
    await appWindow.evaluate(id => (window as unknown as Hronaut).hronaut.back(id), tabId)
    // Back goes exactly one step, to the page checked, which opens the next by script again.
    await expect.poll(() => allowedRequests).toContain('/redirect')
    await expect.poll(async () => { const shown = await tab(); return shown?.url === `${allowed}/next` && !shown.loading }).toBe(true)
    expect(droppedRequests).toEqual([])
  } finally {
    await closeFixtureServer(allowedServer)
    await closeFixtureServer(droppedServer)
  }
})


// A page's own script that goes back past the page that opened it is checked as the page navigating, before it loads.
test('A page cannot go back by script to a page the workspace stopped allowing', async ({ appWindow, electronApp }) => {
  const allowedRequests: string[] = []
  const droppedRequests: string[] = []
  const allowedServer = site(allowedRequests)
  const droppedServer = site(droppedRequests)
  const allowed = await listen(allowedServer)
  const dropped = await listen(droppedServer)
  try {
    const { workspace, tabId } = await appWindow.evaluate(async (dropped) => {
      const hronaut = (window as unknown as Hronaut).hronaut
      const name = `History script ${Date.now()}`
      const created = await hronaut.createWorkspace({ name, storage: 'scratch' })
      const workspace = created.mcpTabGroups.find(group => group.name === name)!.id
      const tabId = (await hronaut.newTab({ url: `${dropped}/`, mcpGroupId: workspace, active: true })).activeTabId!
      return { workspace, tabId }
    }, dropped)
    const tab = () => appWindow.evaluate(id => (window as unknown as Hronaut).hronaut.getState()
      .then(state => state.tabs.find(tab => tab.id === id)), tabId)
    await expect.poll(async () => { const shown = await tab(); return shown?.url === `${dropped}/` && !shown.loading }).toBe(true)
    await appWindow.evaluate(({ tabId, url }) => (window as unknown as Hronaut).hronaut.navigate({ tabId, url }), { tabId, url: `${allowed}/redirect` })
    await expect.poll(async () => { const shown = await tab(); return shown?.url === `${allowed}/next` && !shown.loading }).toBe(true)

    await appWindow.evaluate(({ workspace, allowed }) => (window as unknown as Hronaut).hronaut
      .updateWorkspaceNavigationPolicy(workspace, { mode: 'restricted', rules: [allowed] }), { workspace, allowed })
    droppedRequests.length = 0
    // Without a user gesture, as the page's own script runs.
    await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)
      if (!page) throw new Error('Missing page that goes back by script')
      await page.executeJavaScript('history.go(-2)')
    }, `${allowed}/next`)
    await expect.poll(() => appWindow.evaluate(id => (window as unknown as Hronaut).hronaut.listWorkspaceNavigationAudit(id), workspace))
      .toEqual(expect.arrayContaining([expect.objectContaining({ targetOrigin: dropped, reason: 'no-match', source: 'page' })]))
    expect((await tab())?.url).toBe(`${allowed}/next`)
    expect(droppedRequests).toEqual([])
  } finally {
    await closeFixtureServer(allowedServer)
    await closeFixtureServer(droppedServer)
  }
})

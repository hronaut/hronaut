import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserNetworkRequest, BrowserNetworkRequestDetails, HronautApi } from '../../src/shared/types.js'
import { expect, test, text as toolText } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

const text = (value: unknown): string => toolText(value as CallToolResult)

type NativeEvent = { method: string; params: { requestId?: string; timestamp?: number; newPriority?: string; request?: { url?: string; initialPriority?: string } } }
type PriorityScope = typeof globalThis & { __priorityProbe?: { events: NativeEvent[]; restore(): void } }

test('reports a real Chromium priority transition in MCP, selected details and sanitized JSON', async ({ capabilities, electronApp, appWindow }, testInfo) => {
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/image')) {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' })
        response.end('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="blue"/></svg>')
      }, 700)
    } else {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>Native priorities</title><img src="/image-hero.svg" width="800" height="600"><div style="height:4000px"></div><img id="later" src="/image-later.svg" width="800" height="600"><script>requestAnimationFrame(()=>document.querySelector("#later").style.position="fixed")</script>')
    }
  })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
    const { client, tabId, openPageTool } = capabilities
    expect((await client.callTool({ name: 'browser_network', arguments: { tabId } })).isError).not.toBe(true)
    await electronApp.evaluate(({ webContents }, fixtureUrl) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!
      const events: NativeEvent[] = []
      const listener = (_event: Electron.Event, method: string, params: NativeEvent['params']) => {
        if (['Network.requestWillBeSent', 'Network.resourceChangedPriority'].includes(method) && events.length < 40) events.push({ method, params })
      }
      page.debugger.on('message', listener)
      ;(globalThis as PriorityScope).__priorityProbe = { events, restore: () => { page.debugger.removeListener('message', listener) } }
    }, capabilities.fixtureUrl)
    const navigation = await client.callTool({ name: 'browser_navigate', arguments: { tabId, url } })
    expect(navigation.isError, text(navigation)).not.toBe(true)
    const native = await electronApp.evaluate(() => ({ versions: process.versions, events: (globalThis as PriorityScope).__priorityProbe!.events }))
    const initial = native.events.find(e => e.method === 'Network.requestWillBeSent' && e.params.request?.url === `${url}image-hero.svg`)!
    expect(initial).toBeTruthy()
    const changes = native.events.filter(e => e.method === 'Network.resourceChangedPriority' && e.params.requestId === initial.params.requestId)
    expect(changes.length).toBeGreaterThan(0)
    const latest = changes.at(-1)!
    expect(latest.params.newPriority).not.toBe(initial.params.request!.initialPriority)
    expect(latest.params.timestamp!).toBeGreaterThan(initial.params.timestamp!)
    await testInfo.attach('native-priority', { body: JSON.stringify(native, null, 2), contentType: 'application/json' })
    const list = JSON.parse(text(await client.callTool({ name: 'browser_network', arguments: { tabId } }))) as BrowserNetworkRequest[]
    const request = list.find(r => r.url === `${url}image-hero.svg`)!
    expect(request).toBeTruthy()
    expect(request).not.toHaveProperty('priority')
    const result = await client.callTool({ name: 'browser_network_request', arguments: { tabId, requestId: request.id } })
    expect(result.isError, text(result)).not.toBe(true)
    const details = JSON.parse(text(result)) as BrowserNetworkRequestDetails
    const priority = { initial: initial.params.request!.initialPriority, latestObserved: latest.params.newPriority }
    expect(details.priority).toEqual(priority)
    expect(Object.keys(details.priority!).sort()).toEqual(['initial', 'latestObserved'])
    expect(text(result)).not.toContain(initial.params.requestId!)
    await openPageTool('Open network monitor')
    const panel = appWindow.getByRole('dialog', { name: 'Network', exact: true })
    await panel.getByRole('searchbox', { name: 'Filter network requests', exact: true }).fill('image-hero.svg')
    await panel.getByRole('listbox', { name: 'Network requests' }).getByRole('option').click()
    const section = panel.getByRole('region', { name: 'Request priority', exact: true })
    const label = (value: string | undefined) => ({ VeryLow: 'Very low', Low: 'Low', Medium: 'Medium', High: 'High', VeryHigh: 'Very high' } as Record<string, string>)[value ?? '']
    await expect(section.locator('dd')).toHaveText([label(priority.initial)!, label(priority.latestObserved)!])
    await expect(section).toContainText('not a final priority')
    await panel.getByRole('button', { name: 'Refresh selected request details', exact: true }).click()
    await expect(section.locator('dd')).toHaveText([label(priority.initial)!, label(priority.latestObserved)!])
    await panel.getByRole('button', { name: 'Copy JSON', exact: true }).click()
    await expect(panel.getByRole('button', { name: 'Copied JSON', exact: true })).toBeVisible()
    const copied = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(JSON.parse(copied).priority).toEqual(priority)
    expect(copied).not.toContain(initial.params.requestId!)
    const after = JSON.parse(text(await client.callTool({ name: 'browser_network', arguments: { tabId } }))) as BrowserNetworkRequest[]
    expect(after.map(r => r.id)).toEqual(list.map(r => r.id))
    const foreign = await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: false }), url)
    const foreignTab = foreign.tabs.find(t => t.id !== tabId && t.url === url)!
    expect(foreignTab).toBeTruthy()
    const denied = await client.callTool({ name: 'browser_network_request', arguments: { tabId: foreignTab.id, requestId: request.id } })
    expect(denied.isError, text(denied)).toBe(true)
    expect(text(denied)).not.toContain('latestObserved')
  } finally {
    await electronApp.evaluate(() => { (globalThis as PriorityScope).__priorityProbe?.restore(); delete (globalThis as PriorityScope).__priorityProbe }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})

type DetailGate = { ready: boolean; release(): void; restore(): void }
type DetailScope = typeof globalThis & { __priorityDetailGate?: DetailGate }
for (const phase of ['body', 'audit'] as const) for (const boundary of ['unchanged', 'clear', 'navigation-preserved', 'same-document-navigation', 'pause', 'tab-handoff', 'workspace-access', 'detach', 'close'] as const) {
  test(`priority detail publication respects ${boundary} during ${phase} settlement`, async ({ capabilities, electronApp, appWindow }) => {
    const { client, tabId, fixtureUrl } = capabilities
    await client.callTool({ name: 'browser_network', arguments: { tabId } })
    const seeded = await client.callTool({ name: 'browser_evaluate', arguments: {
      tabId, script: "fetch('/api-details?priority-read=1', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'priority-publication-canary'})}).then(r=>r.json())"
    } })
    expect(seeded.isError, text(seeded)).not.toBe(true)
    const requests = JSON.parse(text(await client.callTool({ name: 'browser_network', arguments: { tabId } }))) as BrowserNetworkRequest[]
    const request = requests.find(r => r.url.includes('priority-read=1'))!
    expect(request.completedAt).toBeTruthy()
    const before = await client.callTool({ name: 'browser_network_request', arguments: { tabId, requestId: request.id } })
    expect(before.isError, text(before)).not.toBe(true)
    expect(JSON.parse(text(before)).priority).toEqual({ initial: 'High', latestObserved: 'High' })
    if (phase === 'audit') {
      const audit = await client.callTool({ name: 'browser_audit_receipts', arguments: { action: 'start' } })
      expect(audit.isError, text(audit)).not.toBe(true)
    }
    await electronApp.evaluate(async ({ webContents, app }, { url, phase }) => {
      if (phase === 'audit') {
        const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises')
        const path = process.getBuiltinModule('node:path') as typeof import('node:path')
        const file = path.join(app.getPath('userData'), 'priority-audit-prototype')
        const handle = await fs.open(file, 'w')
        const prototype = Object.getPrototypeOf(handle) as { writeFile: (...args: unknown[]) => Promise<void> }
        await handle.close(); await fs.unlink(file)
        const original = prototype.writeFile
        let release!: () => void
        const held = new Promise<void>(resolve => { release = resolve })
        const gate: DetailGate = { ready: false, release, restore: () => { prototype.writeFile = original } }
        ;(globalThis as DetailScope).__priorityDetailGate = gate
        prototype.writeFile = async function (...args: unknown[]) {
          await original.apply(this, args)
          if (!gate.ready && String(args[0]).includes('"phase":"outcome"')) { gate.ready = true; await held }
        }
        return
      }
      const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
      const api = page.debugger
      const original = api.sendCommand
      let release!: () => void
      const held = new Promise<void>(resolve => { release = resolve })
      const gate: DetailGate = { ready: false, release, restore: () => { api.sendCommand = original } }
      ;(globalThis as DetailScope).__priorityDetailGate = gate
      api.sendCommand = async (method, ...args) => {
        const result = await original.call(api, method, ...args)
        if (method === 'Network.getResponseBody' && !gate.ready) {
          gate.ready = true
          await held
        }
        return result
      }
    }, { url: fixtureUrl, phase })
    const pending = client.callTool({ name: 'browser_network_request', arguments: { tabId, requestId: request.id } })
    try {
      await expect.poll(() => electronApp.evaluate(() => (globalThis as DetailScope).__priorityDetailGate?.ready)).toBe(true)
      if (boundary === 'clear') {
        await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.listNetworkRequests(id, true), tabId)
      } else if (boundary === 'navigation-preserved' || boundary === 'same-document-navigation') {
        await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setDiagnosticLogPreservation(id, true), tabId)
        await electronApp.evaluate(async ({ webContents }, { url, sameDocument }) => {
          const next = new URL(url)
          if (sameDocument) next.hash = 'new-document-route'
          else next.searchParams.set('next-document', '1')
          await webContents.getAllWebContents().find(p => p.getURL() === url)!.loadURL(next.href)
        }, { url: fixtureUrl, sameDocument: boundary === 'same-document-navigation' })
      } else if (boundary === 'pause') {
        await appWindow.evaluate('window.hronautMcp.setPaused(true)')
        await appWindow.evaluate('window.hronautMcp.setPaused(false)')
      } else if (boundary === 'tab-handoff') {
        await appWindow.evaluate(async id => {
          const api = (window as unknown as { hronaut: HronautApi }).hronaut
          await api.setTabAgentPaused(id, true)
          await api.setTabAgentPaused(id, false)
        }, tabId)
      } else if (boundary === 'workspace-access') {
        await appWindow.evaluate(async id => {
          const api = (window as unknown as { hronaut: HronautApi }).hronaut
          const groupId = (await api.getState()).tabs.find(t => t.id === id)!.mcpGroupId!
          await api.updateTabGroup(groupId, { agentAccess: false })
          await api.updateTabGroup(groupId, { agentAccess: true })
        }, tabId)
      } else if (boundary === 'detach') {
        await electronApp.evaluate(({ webContents }, url) => { webContents.getAllWebContents().find(p => p.getURL() === url)!.debugger.detach() }, fixtureUrl)
      } else if (boundary === 'close') {
        await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), tabId)
      }
      await electronApp.evaluate(() => { const gate = (globalThis as DetailScope).__priorityDetailGate!; gate.release(); gate.restore() })
      const result = await pending
      if (boundary === 'unchanged') {
        expect(result.isError, text(result)).not.toBe(true)
        expect(JSON.parse(text(result)).priority).toEqual(JSON.parse(text(before)).priority)
      } else {
        expect(result.isError, text(result)).toBe(true)
        expect(text(result)).not.toContain('priority-publication-canary')
        expect(text(result)).not.toContain('latestObserved')
      }
      if (boundary === 'clear' || boundary === 'pause') {
        const fresh = await client.callTool({ name: 'browser_network_request', arguments: { tabId, requestId: request.id } })
        expect(fresh.isError, text(fresh)).toBe(true)
        const list = await client.callTool({ name: 'browser_network', arguments: { tabId } })
        expect(text(list)).not.toContain(request.id)
      }
    } finally {
      await electronApp.evaluate(() => { const gate = (globalThis as DetailScope).__priorityDetailGate; gate?.release(); gate?.restore(); delete (globalThis as DetailScope).__priorityDetailGate }).catch(() => undefined)
      await pending.catch(() => undefined)
    }
  })
}

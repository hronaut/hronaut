import { createServer } from 'node:http'
import { closeFixtureServer } from './fixtures.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState, BrowserTabState, HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type Discovery = { tabs: Array<{ id: string; title: string; url: string }>; matching: number; returned: number; truncated: boolean }

test('discovers projected tabs within one workspace without exposing omitted URL details or full state', async ({ capabilities, appWindow }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result))
  }
  const full = () => call('browser_tabs') as Promise<BrowserTabState[]>
  const search = (query = '', limit = 20) => call('browser_tabs', { search: { query, limit } }) as Promise<Discovery>
  await call('browser_evaluate', { tabId, script: "document.title='Alpha Billing'; ({ ready: true })" })
  await expect.poll(async () => (await full()).find(t => t.id === tabId)?.title).toBe('Alpha Billing')
  const before = new Set((await full()).map(t => t.id))
  const state = await call('browser_new_tab', { url: fixtureUrl + '#fragment-canary', active: false }) as BrowserState
  const beta = state.tabs.find(t => !before.has(t.id))!
  await call('browser_evaluate', { tabId: beta.id, script: "document.title='Beta Reports'; ({ ready: true })" })
  await expect.poll(async () => (await full()).find(t => t.id === beta.id)?.title).toBe('Beta Reports')
  const outside = await call('browser_workspaces', { action: 'create', name: 'Outside discovery', storage: 'scratch' }) as { id: string }
  await appWindow.evaluate(({ url, groupId }) => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, mcpGroupId: groupId, active: false }), { url: fixtureUrl.replace('view=capabilities', 'view=outside-only'), groupId: outside.id })
  const found = await search('127.0.0.1 ALPHA')
  expect(found).toMatchObject({ returned: 1, matching: 1, truncated: false, tabs: [{ id: tabId, title: 'Alpha Billing' }] })
  expect(Object.keys(found.tabs[0]!).sort()).toEqual(['id', 'title', 'url'])
  expect(JSON.stringify(found)).not.toContain('top-level-navigation-secret')
  for (const query of ['top-level-navigation-secret', 'fragment-canary', 'alpha beta', 'outside-only', 'missing-word']) {
    expect(await search(query)).toMatchObject({ matching: 0, returned: 0, tabs: [] })
  }
  expect(await search('', 1)).toMatchObject({ returned: 1, matching: 2, truncated: true })
  expect((await search()).tabs.map(t => t.id)).toEqual([tabId, beta.id])
  const original = (await full()).find(t => t.id === tabId)!
  expect(original).toHaveProperty('loading')
  expect(original.url).toContain('top-level-navigation-secret')
  await call('browser_close_tab', { tabId: beta.id })
  expect(await search('beta')).toMatchObject({ matching: 0, returned: 0 })
})

test('compact discovery leaves sleeping tabs, selection and native focus untouched', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId, fixtureUrl, fixtureOrigin } = capabilities
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result))
  }
  await call('browser_evaluate', { tabId, script: "document.title='Sleeping Discovery'; ({ ready: true })" })
  const other = await call('browser_new_tab', { url: 'about:blank', active: true }) as BrowserState
  // Leave the capture-capable fixture page for a plain page before establishing sleep.
  await electronApp.evaluate(async ({ webContents }, { url, next }) => {
    await webContents.getAllWebContents().find(w => w.getURL() === url)!.loadURL(next)
  }, { url: fixtureUrl, next: fixtureOrigin + '/route-target' })
  await appWindow.evaluate(async ({ id, other }) => {
    const api = (window as unknown as { hronaut: HronautApi }).hronaut
    await api.selectTab(other)
    await api.setTabSleeping(id, true)
  }, { id: tabId, other: other.activeTabId! })
  const before = await call('browser_status') as BrowserState
  expect(before.tabs.find(t => t.id === tabId)?.sleeping).toBe(true)
  const focus = await electronApp.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.id ?? null)
  const result = await call('browser_tabs', { search: { query: '127.0.0.1' } }) as Discovery
  expect(result).toMatchObject({ returned: 1, matching: 1, tabs: [{ id: tabId }] })
  const after = await call('browser_status') as BrowserState
  expect(after.activeTabId).toBe(before.activeTabId)
  expect(after.tabs.find(t => t.id === tabId)).toEqual(before.tabs.find(t => t.id === tabId))
  expect(await electronApp.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.id ?? null)).toBe(focus)
})


for (const longUrl of [false, true]) test(`compact discovery omits ${longUrl ? 'truncated' : 'raw'} URL fallback titles while loading and after a titleless document`, async ({ capabilities, electronApp }, testInfo) => {
  const { client } = capabilities
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let releaseNext!: () => void
  const nextGate = new Promise<void>(resolve => { releaseNext = resolve })
  let nextRequested = false
  const server = createServer(async (request, response) => {
    if (request.url?.startsWith('/retained')) { nextRequested = true; await nextGate }
    await gate
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><body>Titleless fixture</body>')
  })
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return name === 'browser_wait' ? result : JSON.parse(text(result))
  }
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing titleless fixture address')
    const url = `http://127.0.0.1:${address.port}/fallback-path?token=fallback-secret${longUrl ? '&padding=' + 'x'.repeat(700) : ''}#fallback-fragment`
    const before = new Set((await call('browser_tabs') as BrowserTabState[]).map(tab => tab.id))
    const state = await call('browser_new_tab', { url, active: false }) as BrowserState
    const id = state.tabs.find(tab => !before.has(tab.id))!.id
    const observations: unknown[] = []
    // Capture both real producer states before testing privacy, so a loading failure does not mask titleless evidence.
    for (const phase of ['loading', 'titleless']) {
      if (phase === 'titleless') { release(); await call('browser_wait', { tabId: id }) }
      const legacy = (await call('browser_tabs') as BrowserTabState[]).find(tab => tab.id === id)!
      const compact = await call('browser_tabs', { search: { query: 'fallback-path' } })
      const secret = await call('browser_tabs', { search: { query: 'fallback-secret' } })
      const fragment = await call('browser_tabs', { search: { query: 'fallback-fragment' } })
      observations.push({ phase, legacy, compact, secret, fragment })
    }
    await testInfo.attach('fallback-title-states', { body: JSON.stringify(observations, null, 2), contentType: 'application/json' })
    for (const item of observations as Array<{ phase: string; legacy: BrowserTabState; compact: Discovery; secret: Discovery; fragment: Discovery }>) {
      expect(item.legacy.url).toBe(url)
      expect(item.legacy.title).toContain('fallback-secret')
      if (longUrl) expect(item.legacy.title.length).toBeLessThanOrEqual(512)
      expect(item.legacy.loading).toBe(item.phase === 'loading')
      expect(item.compact).toMatchObject({ eligible: 2, matching: 1, returned: 1, tabs: [{ id, title: '' }] })
      expect(JSON.stringify(item.compact)).not.toMatch(/fallback-secret|fallback-fragment/)
      for (const result of [item.secret, item.fragment]) expect(result).toMatchObject({ eligible: 2, matching: 0, returned: 0, tabs: [] })
    }
    const retainedTitle = (await call('browser_tabs') as BrowserTabState[]).find(tab => tab.id === id)!.title
    await electronApp.evaluate(({ webContents }, { url, next }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      void page.loadURL(next).catch(() => undefined)
    }, { url, next: `http://127.0.0.1:${address.port}/retained` })
    await expect.poll(() => nextRequested).toBe(true)
    const retained = (await call('browser_tabs') as BrowserTabState[]).find(tab => tab.id === id)!
    expect(retained.title).toBe(retainedTitle)
    expect(retained.loading).toBe(true)
    for (const query of ['fallback-secret', 'fallback-fragment']) {
      expect(await call('browser_tabs', { search: { query } })).toMatchObject({ eligible: 2, matching: 0, returned: 0, tabs: [] })
    }
    const retainedCompact = await call('browser_tabs', { search: {} }) as Discovery
    expect(retainedCompact).toMatchObject({ eligible: 2, matching: 2, returned: 2 })
    expect(retainedCompact.tabs.find(tab => tab.id === id)?.title).toBe('')
    releaseNext()
    await call('browser_wait', { tabId: id })
    const authored = await client.callTool({ name: 'browser_evaluate', arguments: { tabId: id, script: "document.title='Authored fallback-secret'; ({ ready: true })" } }) as CallToolResult
    expect(authored.isError, text(authored)).not.toBe(true)
    await expect.poll(async () => (await call('browser_tabs', { search: { query: 'Authored fallback-secret' } })).returned).toBe(1)
    // Authored text is deliberately searchable: URL omission is not arbitrary-title DLP.
    const navigated = await client.callTool({ name: 'browser_navigate', arguments: { tabId: id, url } }) as CallToolResult
    expect(navigated.isError, text(navigated)).not.toBe(true)
    await call('browser_wait', { tabId: id })
    expect(await call('browser_tabs', { search: { query: 'Authored' } })).toMatchObject({ eligible: 2, matching: 0, returned: 0 })
  } finally { release(); releaseNext(); await closeFixtureServer(server) }
})

for (const sameDocument of [false, true]) test(`titleless duplicated ${sameDocument ? 'same-document' : 'cross-document'} native history does not promote URL fallbacks into discovery titles`, async ({ capabilities, appWindow, electronApp }, testInfo) => {
  const { client } = capabilities
  let hold = false
  let holdScripts = false
  const scripts: Array<() => void> = []
  const releaseScripts = () => { holdScripts = false; for (const reply of scripts.splice(0)) reply() }
  const replies: Array<() => void> = []
  const release = () => { hold = false; for (const reply of replies.splice(0)) reply() }
  const server = createServer((request, response) => {
    if (request.url === '/history-barrier.js') {
      const reply = () => { response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); response.end('void 0') }
      if (holdScripts) scripts.push(reply)
      else reply()
      return
    }
    const reply = () => {
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
      response.end('<!doctype html><script src="/history-barrier.js"></script><body>Titleless history fixture</body>')
    }
    if (hold) replies.push(reply)
    else reply()
  })
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return name === 'browser_wait' ? result : JSON.parse(text(result))
  }
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing history fixture address')
    const urls = [1, 2].map(index => `http://127.0.0.1:${address.port}/history-${sameDocument ? 1 : index}?token=history-secret-${index}#history-fragment-${index}`)
    const before = new Set((await call('browser_tabs') as BrowserTabState[]).map(tab => tab.id))
    const opened = await call('browser_new_tab', { url: urls[0], active: false }) as BrowserState
    const source = opened.tabs.find(tab => !before.has(tab.id))!.id
    await call('browser_wait', { tabId: source })
    if (sameDocument) {
      const routed = await client.callTool({ name: 'browser_evaluate', arguments: { tabId: source, script: `history.pushState({}, '', ${JSON.stringify(urls[1])}); ({ ready: true })` } }) as CallToolResult
      expect(routed.isError, text(routed)).not.toBe(true)
    } else await call('browser_navigate', { tabId: source, url: urls[1] })
    await call('browser_wait', { tabId: source })
    const sourceHistory = await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL() === url)!.navigationHistory.getAllEntries().map(({ title, url }) => ({ title, url })), urls[1]!)
    const existing = new Set((await call('browser_tabs') as BrowserTabState[]).map(tab => tab.id))
    await electronApp.evaluate(({ Menu, app }) => {
      const probe = globalThis as typeof globalThis & { historyTitleEvents?: unknown[]; cleanupHistoryTitles?: () => void }
      const events: unknown[] = []; probe.historyTitleEvents = events
      const cleanups: Array<() => void> = []
      const created = (_event: Electron.Event, contents: Electron.WebContents) => {
        const title = (_event: Electron.Event, title: string, explicitSet: boolean) => { if (events.length < 40) events.push({ type: 'title', title, explicitSet }) }
        const nav = (_event: Electron.Event, url: string, sameDocument: boolean, main: boolean) => { if (main && events.length < 40) events.push({ type: 'start', url, sameDocument }) }
        contents.on('page-title-updated', title); contents.on('did-start-navigation', nav)
        cleanups.push(() => { contents.removeListener('page-title-updated', title); contents.removeListener('did-start-navigation', nav) })
      }
      app.on('web-contents-created', created)
      probe.cleanupHistoryTitles = () => { app.removeListener('web-contents-created', created); for (const cleanup of cleanups) cleanup() }
      const scope = globalThis as typeof globalThis & { discoveryMenu?: Electron.Menu; originalDiscoveryPopup?: typeof Menu.prototype.popup }
      scope.originalDiscoveryPopup = Menu.prototype.popup
      Menu.prototype.popup = function () { scope.discoveryMenu = this }
    })
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.showTabContextMenu(id), source)
    hold = true
    holdScripts = true
    await electronApp.evaluate(() => {
      const menu = (globalThis as typeof globalThis & { discoveryMenu?: Electron.Menu }).discoveryMenu
      const item = menu?.getMenuItemById('duplicate-tab')
      if (!item?.enabled || !item.click) throw new Error('Duplicate tab menu action unavailable')
      ;(item.click as unknown as () => void)()
    })
    await expect.poll(async () => (await call('browser_tabs') as BrowserTabState[]).filter(tab => !existing.has(tab.id)).length).toBe(1)
    const id = (await call('browser_tabs') as BrowserTabState[]).find(tab => !existing.has(tab.id))!.id
    const observations: unknown[] = []
    for (const phase of ['duplicate', 'back', 'forward', 'wake'] as const) {
      if (phase !== 'duplicate') {
        if (phase === 'wake') await appWindow.evaluate(async ({ id, source }) => {
          const api = (window as unknown as { hronaut: HronautApi }).hronaut
          await api.selectTab(source)
          await api.setTabSleeping(id, true)
        }, { id, source })
        hold = !sameDocument || phase === 'wake'
        holdScripts = true
        await appWindow.evaluate(({ id, phase }) => {
          const api = (window as unknown as { hronaut: HronautApi }).hronaut
          void (phase === 'wake' ? api.setTabSleeping(id, false) : phase === 'back' ? api.back(id) : api.forward(id))
        }, { id, phase })
      }
      if (!sameDocument || phase === 'duplicate' || phase === 'wake') await expect.poll(() => replies.length).toBeGreaterThan(0)
      const pendingLegacy = (await call('browser_tabs') as BrowserTabState[]).find(tab => tab.id === id)!
      const pendingCompact = await call('browser_tabs', { search: {} }) as Discovery
      const pendingQueries = []
      for (const query of ['history-secret-1', 'history-secret-2', 'history-fragment-1', 'history-fragment-2']) pendingQueries.push(await call('browser_tabs', { search: { query } }))
      observations.push({ phase: phase + '-pending', legacy: pendingLegacy, compact: pendingCompact, queries: pendingQueries })
      release()
      await expect.poll(async () => scripts.length > 0 || !(await call('browser_tabs') as BrowserTabState[]).find(tab => tab.id === id)!.loading).toBe(true)
      const committedLegacy = (await call('browser_tabs') as BrowserTabState[]).find(tab => tab.id === id)!
      const committedCompact = await call('browser_tabs', { search: {} }) as Discovery
      const committedQueries = []
      for (const query of ['history-secret-1', 'history-secret-2', 'history-fragment-1', 'history-fragment-2']) committedQueries.push(await call('browser_tabs', { search: { query } }))
      observations.push({ phase: phase + '-committed', legacy: committedLegacy, compact: committedCompact, queries: committedQueries })
      releaseScripts()
      await call('browser_wait', { tabId: id })
      const legacy = (await call('browser_tabs') as BrowserTabState[]).find(tab => tab.id === id)!
      const compact = await call('browser_tabs', { search: {} }) as Discovery
      const queries = []
      for (const query of ['history-secret-1', 'history-secret-2', 'history-fragment-1', 'history-fragment-2']) {
        queries.push(await call('browser_tabs', { search: { query } }))
      }
      observations.push({ phase, legacy, compact, queries })
    }
    await call('browser_evaluate', { tabId: id, script: "document.title='Fresh authored history title'; ({ ready: true })" })
    await expect.poll(async () => (await call('browser_tabs', { search: { query: 'Fresh authored history title' } })).returned).toBe(1)
    await testInfo.attach('native-history-title-events', { body: JSON.stringify({ sourceHistory, events: await electronApp.evaluate(() => (globalThis as typeof globalThis & { historyTitleEvents?: unknown[] }).historyTitleEvents) }), contentType: 'application/json' })
    await testInfo.attach('duplicated-titleless-history', { body: JSON.stringify(observations, null, 2), contentType: 'application/json' })
    for (const item of observations as Array<{ phase: string; legacy: BrowserTabState; compact: Discovery; queries: Discovery[] }>) {
      if (['duplicate', 'back', 'forward', 'wake'].includes(item.phase)) expect(item.legacy.url).toBe(urls[item.phase === 'back' ? 0 : 1])
      expect(item.legacy.title).toContain('history-secret-')
      expect(item.compact).toMatchObject({ eligible: 3, matching: 3, returned: 3 })
      expect(item.compact.tabs.find(tab => tab.id === id)?.title).toBe('')
      expect(JSON.stringify(item.compact)).not.toMatch(/history-secret-|history-fragment-/)
      for (const result of item.queries) expect(result).toMatchObject({ eligible: 3, matching: 0, returned: 0, tabs: [] })
    }
  } finally {
    release()
    releaseScripts()
    await electronApp.evaluate(({ Menu }) => {
      const scope = globalThis as typeof globalThis & { discoveryMenu?: Electron.Menu; originalDiscoveryPopup?: typeof Menu.prototype.popup }
      const probe = globalThis as typeof globalThis & { historyTitleEvents?: unknown[]; cleanupHistoryTitles?: () => void }
      probe.cleanupHistoryTitles?.(); delete probe.cleanupHistoryTitles; delete probe.historyTitleEvents
      if (scope.originalDiscoveryPopup) Menu.prototype.popup = scope.originalDiscoveryPopup
      delete scope.discoveryMenu
      delete scope.originalDiscoveryPopup
    }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})

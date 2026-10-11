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
  const { client, tabId, fixtureUrl, fixtureOrigin, counters } = capabilities
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
  const ticks = counters.memorySaverTicks
  const result = await call('browser_tabs', { search: { query: '127.0.0.1' } }) as Discovery
  expect(result).toMatchObject({ returned: 1, matching: 1, tabs: [{ id: tabId }] })
  const after = await call('browser_status') as BrowserState
  expect(after.activeTabId).toBe(before.activeTabId)
  expect(after.tabs.find(t => t.id === tabId)).toEqual(before.tabs.find(t => t.id === tabId))
  expect(await electronApp.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.id ?? null)).toBe(focus)
  expect(counters.memorySaverTicks).toBe(ticks)
})

import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'
import { closeHronaut } from './fixtures.js'

const call = (client: Client, name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>

/** A page that shows idle, loading, then the response text or failed. */
async function preparePage(client: Client, tabId: string): Promise<void> {
  const prepared = await call(client, 'browser_evaluate', {
    tabId,
    script: `document.body.innerHTML='<p id="state">idle</p>';window.loadItems=()=>{const state=document.getElementById('state');state.textContent='loading';fetch('/route-target?held').then(r=>r.text()).then(t=>{state.textContent='done:'+t},()=>{state.textContent='failed'})};true`
  })
  expect(prepared.isError, text(prepared)).not.toBe(true)
}

const pageState = async (client: Client, tabId: string): Promise<string> => text(await call(client, 'browser_evaluate', { tabId, script: `document.getElementById('state')?.textContent ?? 'gone'` }))

/** Adds a hold rule, starts the page's request and waits until Hronaut holds it. */
async function holdOne(client: Client, tabId: string, port: number, holdSeconds = 30): Promise<string> {
  const added = await call(client, 'browser_network_routes', {
    action: 'add', tabId, urlPattern: `http://127.0.0.1:${port}/route-target*`,
    response: { status: 200, headers: { 'content-type': 'text/plain' }, body: 'mocked' },
    holdUntilReleased: true, holdSeconds
  })
  expect(added.isError, text(added)).not.toBe(true)
  const route = (JSON.parse(text(added)) as Array<{ id: string; hold?: { seconds: number } }>).at(-1)!
  expect(route.hold).toEqual({ seconds: holdSeconds })
  await call(client, 'browser_evaluate', { tabId, script: 'window.loadItems();true' })
  await expect.poll(async () => (JSON.parse(text(await call(client, 'browser_network_routes', { action: 'held', tabId }))) as Array<{ routeId: string }>).map(held => held.routeId)).toEqual([route.id])
  return route.id
}

test('a held mock keeps the page loading until release, then answers it once without the real endpoint', async ({ capabilities }) => {
  const { client, tabId, address, counters } = capabilities
  await preparePage(client, tabId)
  const routeId = await holdOne(client, tabId, address.port)
  const held = text(await call(client, 'browser_network_routes', { action: 'held', tabId }))
  expect(held).not.toContain('?held')
  expect(held).not.toContain('mocked')
  // The page stays in its loading state while inspection and other requests continue.
  expect(await pageState(client, tabId)).toBe('loading')
  const snapshot = await call(client, 'browser_snapshot', { tabId })
  expect(text(snapshot)).toContain('loading')
  expect(text(await call(client, 'browser_evaluate', { tabId, script: `fetch(location.href).then(r=>r.status)` }))).toBe('200')
  const released = await call(client, 'browser_network_routes', { action: 'release', tabId, routeId })
  expect(released.isError, text(released)).not.toBe(true)
  expect(JSON.parse(text(released))).toEqual({ status: 'RELEASED', routeId })
  await expect.poll(() => pageState(client, tabId)).toBe('done:mocked')
  const again = await call(client, 'browser_network_routes', { action: 'release', tabId, routeId })
  expect(again.isError).toBe(true)
  expect(again.structuredContent).toMatchObject({ status: 'NOT_DISPATCHED', effects: 'none', reason: 'released' })
  expect(text(again)).toContain('its response was already released')
  expect(counters.routeRequests).toBe(0)
  expect(JSON.parse(text(await call(client, 'browser_network_routes', { action: 'held', tabId })))).toEqual([])
})

for (const ending of ['cancel', 'timeout', 'clear', 'reload', 'close', 'devtools', 'quit'] as const) {
  test(`a hold ended by ${ending} fails its request and never sends it to the real endpoint`, async ({ capabilities, appWindow, electronApp }) => {
    const { client, address, counters, fixtureUrl } = capabilities
    let tabId = capabilities.tabId
    if (ending === 'close') {
      const opened = await call(client, 'browser_new_tab', { url: fixtureUrl, active: true })
      tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
      await call(client, 'browser_wait', { tabId })
    }
    await preparePage(client, tabId)
    const routeId = await holdOne(client, tabId, address.port, ending === 'timeout' ? 1 : 30)
    if (ending === 'cancel') expect(JSON.parse(text(await call(client, 'browser_network_routes', { action: 'cancel', tabId, routeId })))).toEqual({ status: 'CANCELLED', routeId })
    if (ending === 'clear') expect((await call(client, 'browser_network_routes', { action: 'clear', tabId })).isError).not.toBe(true)
    if (ending === 'reload') await call(client, 'browser_navigate', { tabId, url: fixtureUrl })
    if (ending === 'close') expect((await call(client, 'browser_close_tab', { tabId })).isError).not.toBe(true)
    if (ending === 'devtools') {
      // Capture uses up the rule; Developer Tools wait for that change to settle.
      await expect.poll(async () => (await call(client, 'browser_network_routes', { action: 'list', tabId })).isError).not.toBe(true)
      await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.toggleDevTools(id), tabId)
    }
    if (ending === 'quit') await closeHronaut(electronApp)
    if (ending === 'cancel' || ending === 'timeout' || ending === 'clear' || ending === 'devtools') {
      await expect.poll(() => pageState(client, tabId)).toBe('failed')
    }
    // Give a resumed request time to arrive before checking it never did.
    await new Promise(resolve => setTimeout(resolve, 1_500))
    expect(counters.routeRequests).toBe(0)
    if (ending !== 'close' && ending !== 'quit') {
      const late = await call(client, 'browser_network_routes', { action: 'release', tabId, routeId })
      expect(late.isError).toBe(true)
      expect(late.structuredContent).toMatchObject({ status: 'NOT_DISPATCHED', effects: 'none', routeId, reason: { cancel: 'cancelled', timeout: 'timed-out', clear: 'cleared', reload: 'navigated', devtools: 'detached' }[ending] })
      expect(text(late)).toContain(`No request is held for route ${routeId}`)
    }
  })
}

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const text = (result: CallToolResult): string => result.content.filter(item => item.type === 'text').map(item => item.type === 'text' ? item.text : '').join('\n')

test('deletes exactly one cookie by observed domain and path without collateral deletion', async ({ electronApp, mcpPort, mcpToken }) => {
  const server = createServer((_request, response) => response.end('<!doctype html><title>Cookie scope</title>'))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const pageUrl = `${origin}/checkout/page`
  const client = new Client({ name: 'cookie-exact-delete-test', version: '1' })
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  const openTab = async (name: string): Promise<{ workspaceId: string; tabId: string }> => {
    const workspace = await call('browser_workspaces', { action: 'create', name, storage: 'scratch' })
    expect(workspace.isError, text(workspace)).not.toBe(true)
    const workspaceId = (JSON.parse(text(workspace)) as { id: string }).id
    const opened = await call('browser_new_tab', { workspaceId, url: pageUrl })
    expect(opened.isError, text(opened)).not.toBe(true)
    const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
    const ready = await call('browser_wait', { workspaceId, tabId, timeoutMs: 8_000 })
    expect(ready.isError, text(ready)).not.toBe(true)
    return { workspaceId, tabId }
  }
  // Each workspace has its own session; address the tab's session by its URL and session identity.
  const native = <T>(index: number, script: string): Promise<T> => electronApp.evaluate(async ({ webContents }, { pageUrl, index, script }) => {
    const pages = webContents.getAllWebContents().filter(candidate => candidate.getURL() === pageUrl)
    const page = pages[index]!
    const store = page.session.cookies
    const cdp = async (method: string, params?: Record<string, unknown>) => {
      const attachedHere = !page.debugger.isAttached()
      if (attachedHere) page.debugger.attach('1.3')
      try { return await page.debugger.sendCommand(method, params) } finally { if (attachedHere) page.debugger.detach() }
    }
    const list = async () => (await store.get({ url: pageUrl })).map(cookie => `${cookie.name}=${cookie.value}@${cookie.domain}${cookie.path}`).sort()
    return await (new Function('store', 'cdp', 'list', 'origin', `return (async () => { ${script} })()`))(store, cdp, list, new URL(pageUrl).origin)
  }, { pageUrl, index, script })
  const seed = `
    await store.set({ url: origin, name: 'a', value: 'root', path: '/' })
    await store.set({ url: origin, name: 'a', value: 'checkout', path: '/checkout' })
    await store.set({ url: origin, name: 'b', value: 'other', path: '/checkout' })
    await store.set({ url: origin, name: 'h', value: 'protected', path: '/checkout', httpOnly: true })
    return list()`
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const { workspaceId, tabId } = await openTab('Exact cookie delete')
    const other = await openTab('Other cookie workspace')
    const pages = await electronApp.evaluate(({ webContents }, { pageUrl }) => webContents.getAllWebContents()
      .filter(candidate => candidate.getURL() === pageUrl).length, { pageUrl })
    expect(pages).toBe(2)
    // Identify which native page belongs to which workspace by a marker cookie set through MCP.
    expect((await call('browser_storage', { workspaceId: other.workspaceId, tabId: other.tabId, kind: 'cookies', action: 'set', key: 'marker', value: 'other' })).isError).not.toBe(true)
    const otherIndex = (await native<string[]>(0, 'return list()')).some(entry => entry.startsWith('marker=')) ? 0 : 1
    const index = 1 - otherIndex
    const all = [
      'a=checkout@127.0.0.1/checkout', 'a=root@127.0.0.1/', 'b=other@127.0.0.1/checkout', 'h=protected@127.0.0.1/checkout'
    ]
    expect(await native<string[]>(index, seed)).toEqual(all)
    await native(otherIndex, `await store.set({ url: origin, name: 'a', value: 'other-workspace', path: '/checkout' })`)

    const listed = JSON.parse(text(await call('browser_storage', { workspaceId, tabId, kind: 'cookies' }))) as { items: Array<{ key: string; domain: string; path: string }> }
    expect(listed.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'a', domain: '127.0.0.1', path: '/checkout' }),
      expect.objectContaining({ key: 'a', domain: '127.0.0.1', path: '/' })
    ]))
    const exact = (key: string, cookieDomain: string, cookiePath: string) => call('browser_storage', {
      workspaceId, tabId, kind: 'cookies', action: 'delete', key, cookieDomain, cookiePath
    })

    // Electron's URL-based removal would also delete a=root because it is sent to /checkout.
    const deleted = await exact('a', '127.0.0.1', '/checkout')
    expect(deleted.isError, text(deleted)).not.toBe(true)
    expect(JSON.parse(text(deleted))).toMatchObject({ action: 'delete', changed: true })
    expect(await native<string[]>(index, 'return list()')).toEqual(all.filter(entry => entry !== 'a=checkout@127.0.0.1/checkout'))
    expect(await native<string[]>(index, seed)).toEqual(all)
    expect((await exact('a', '127.0.0.1', '/')).isError).not.toBe(true)
    expect(await native<string[]>(index, 'return list()')).toEqual(all.filter(entry => entry !== 'a=root@127.0.0.1/'))
    expect(await native<string[]>(index, seed)).toEqual(all)

    // No prefix, dot-domain, missing, HttpOnly or malformed selection deletes anything.
    for (const [key, domain, path] of [['a', '127.0.0.1', '/check'], ['a', '.127.0.0.1', '/checkout'], ['missing', '127.0.0.1', '/'], ['h', '127.0.0.1', '/checkout']]) {
      const rejected = await exact(key!, domain!, path!)
      expect(rejected.isError, `${key} ${domain} ${path}`).toBe(true)
      expect(text(rejected)).not.toContain('protected@')
    }
    for (const args of [
      { kind: 'cookies', action: 'delete', key: 'a', cookieDomain: '127.0.0.1' },
      { kind: 'cookies', action: 'delete', key: 'a', cookiePath: '/checkout' },
      { kind: 'cookies', action: 'delete', key: 'a', cookieDomain: '127.0.0.1', cookiePath: 'checkout' },
      { kind: 'cookies', action: 'clear', cookieDomain: '127.0.0.1', cookiePath: '/checkout' },
      { kind: 'local-storage', action: 'delete', key: 'a', cookieDomain: '127.0.0.1', cookiePath: '/checkout' }
    ]) expect((await call('browser_storage', { workspaceId, tabId, ...args })).isError, JSON.stringify(args)).toBe(true)
    expect(await native<string[]>(index, 'return list()')).toEqual(all)

    // Electron listings omit partition keys. A same-identity partitioned cookie
    // makes the selection ambiguous; a partitioned-only identity is rejected.
    const partitioned = (path: string) => `await cdp('Network.setCookie', { name: 'a', value: 'partitioned', domain: '127.0.0.1', path: '${path}', secure: true, sameSite: 'None', partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: true } })`
    await native(index, partitioned('/checkout'))
    expect((await exact('a', '127.0.0.1', '/checkout')).isError).toBe(true)
    await native(index, partitioned('/partitioned-only'))
    expect((await exact('a', '127.0.0.1', '/partitioned-only')).isError).toBe(true)
    const stored = await native<string[]>(index, `return ((await cdp('Network.getAllCookies')).cookies).filter(cookie => cookie.name === 'a').map(cookie => cookie.value + cookie.path).sort()`)
    expect(stored).toEqual(['checkout/checkout', 'partitioned/checkout', 'partitioned/partitioned-only', 'root/'])

    // Other workspaces are untouched, and legacy name-only deletion keeps its contract.
    expect(await native<string[]>(otherIndex, 'return list()')).toEqual(['a=other-workspace@127.0.0.1/checkout', 'marker=other@127.0.0.1/'])
    await native(index, `await cdp('Network.deleteCookies', { name: 'a', domain: '127.0.0.1', path: '/checkout', partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: true } }); await cdp('Network.deleteCookies', { name: 'a', domain: '127.0.0.1', path: '/partitioned-only', partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: true } })`)
    expect((await call('browser_storage', { workspaceId, tabId, kind: 'cookies', action: 'delete', key: 'a' })).isError).not.toBe(true)
    expect(await native<string[]>(index, 'return list()')).toEqual(['b=other@127.0.0.1/checkout', 'h=protected@127.0.0.1/checkout'])

    // Name-only deletion and clear never take an HttpOnly cookie along. Electron's URL-based removal of token=guest
    // would also delete the HttpOnly token on the parent path, which /checkout receives. None of the deletions needs
    // Chromium's debugging connection, so they all work while Developer Tools is open for the tab.
    const devTools = (open: boolean) => electronApp.evaluate(({ webContents }, { pageUrl, index, open }) => {
      const page = webContents.getAllWebContents().filter(candidate => candidate.getURL() === pageUrl)[index]!
      if (open) page.openDevTools({ mode: 'detach', activate: false })
      else page.closeDevTools()
    }, { pageUrl, index, open })
    const devToolsOpen = () => electronApp.evaluate(({ webContents }, { pageUrl, index }) =>
      webContents.getAllWebContents().filter(candidate => candidate.getURL() === pageUrl)[index]!.isDevToolsOpened(), { pageUrl, index })
    await devTools(true)
    await expect.poll(devToolsOpen).toBe(true)
    await native(index, `
      await store.set({ url: origin, name: 'token', value: 'session', path: '/', httpOnly: true })
      await store.set({ url: origin, name: 'token', value: 'guest', path: '/checkout' })`)
    const deletedByName = await call('browser_storage', { workspaceId, tabId, kind: 'cookies', action: 'delete', key: 'token' })
    expect(deletedByName.isError, text(deletedByName)).not.toBe(true)
    expect(JSON.parse(text(deletedByName))).toMatchObject({ action: 'delete', changed: true })
    expect(await native<string[]>(index, 'return list()')).toEqual(['b=other@127.0.0.1/checkout', 'h=protected@127.0.0.1/checkout', 'token=session@127.0.0.1/'])
    await native(index, `await store.set({ url: origin, name: 'token', value: 'guest', path: '/checkout' })`)
    const cleared = await call('browser_storage', { workspaceId, tabId, kind: 'cookies', action: 'clear' })
    expect(cleared.isError, text(cleared)).not.toBe(true)
    expect(await native<string[]>(index, 'return list()')).toEqual(['h=protected@127.0.0.1/checkout', 'token=session@127.0.0.1/'])
    await native(index, `await store.set({ url: origin, name: 'b', value: 'other', path: '/checkout' })`)
    const exactWithDevTools = await exact('b', '127.0.0.1', '/checkout')
    expect(exactWithDevTools.isError, text(exactWithDevTools)).not.toBe(true)
    expect(await native<string[]>(index, 'return list()')).toEqual(['h=protected@127.0.0.1/checkout', 'token=session@127.0.0.1/'])
    expect(await devToolsOpen()).toBe(true)
    await devTools(false)
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})

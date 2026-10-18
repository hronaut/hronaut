import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

interface ClickResult {
  ok?: boolean
  native?: boolean
  modifiers?: string[]
  tabsOpenedDuringClick?: { tabIds: string[] }
}

interface ListState {
  selected: number[]
  events: Array<{ row: number; shift: boolean; ctrl: boolean; meta: boolean; alt: boolean; trusted: boolean }>
}

const PAGE = `<!doctype html><title>Modifier click fixture</title>
<style>li { height: 28px; user-select: none } a, input { display: block; height: 28px }</style>
<ul>${[1, 2, 3, 4, 5].map(row => `<li id="row-${row}" data-row="${row}">Row ${row}</li>`).join('')}</ul>
<a id="link" href="/child">Child page</a>
<input id="after" aria-label="After">
<script>
  let anchor = null
  const selected = new Set()
  window.listState = { selected: [], events: [] }
  for (const row of document.querySelectorAll('li')) row.addEventListener('click', event => {
    const index = Number(row.dataset.row)
    window.listState.events.push({ row: index, shift: event.shiftKey, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, trusted: event.isTrusted })
    if (event.shiftKey && anchor !== null) {
      selected.clear()
      for (let item = Math.min(anchor, index); item <= Math.max(anchor, index); item += 1) selected.add(item)
    } else if (event.ctrlKey || event.metaKey) {
      if (selected.has(index)) selected.delete(index); else selected.add(index)
      anchor = index
    } else {
      selected.clear()
      selected.add(index)
      anchor = index
    }
    window.listState.selected = [...selected].sort((left, right) => left - right)
  })
</script>`

test('holds Shift, Control and Meta for one native click without leaving keys held', async ({ mcpPort, mcpToken }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(request.url?.startsWith('/child') ? '<!doctype html><title>Child page</title>Child' : PAGE)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Page fixture did not expose a port')
  const client = new Client({ name: 'hronaut-modifier-click-test', version: '1.0.0' })
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const textOf = (result: CallToolResult): string => result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const result = await client.callTool({ name, arguments: args }) as CallToolResult
      if (result.isError) throw new Error(textOf(result))
      return JSON.parse(textOf(result)) as T
    }
    const workspaceId = (await call<{ id: string }>('browser_workspaces', { action: 'create', name: 'Modifier clicks' })).id
    const tabId = (await call<{ activeTabId: string }>('browser_new_tab', { workspaceId, url: `http://127.0.0.1:${address.port}/` })).activeTabId
    const ready = await client.callTool({ name: 'browser_wait', arguments: { workspaceId, tabId, selector: '#row-5', state: 'visible' } }) as CallToolResult
    expect(ready.isError, textOf(ready)).not.toBe(true)
    const click = (selector: string, modifiers?: string[]) =>
      call<ClickResult>('browser_click', { workspaceId, tabId, selector, native: true, ...(modifiers ? { modifiers } : {}) })
    const listState = () => call<ListState>('browser_evaluate', { workspaceId, tabId, script: 'window.listState' })
    const controlOrMeta = process.platform === 'darwin' ? { ctrl: false, meta: true } : { ctrl: true, meta: false }

    expect(await click('#row-2')).not.toHaveProperty('modifiers')
    expect(await click('#row-4', ['Shift'])).toMatchObject({ ok: true, native: true, modifiers: ['Shift'] })
    expect((await listState()).selected).toEqual([2, 3, 4])
    await click('#row-1', ['Control'])
    expect((await listState()).selected).toEqual([1, 2, 3, 4])
    await click('#row-3', ['ControlOrMeta'])
    expect((await listState()).selected).toEqual([1, 2, 4])
    await click('#row-5', ['Meta'])
    expect((await listState()).selected).toEqual([1, 2, 4, 5])
    await click('#row-5')
    const state = await listState()
    expect(state.selected).toEqual([5])
    expect(state.events).toEqual([
      { row: 2, shift: false, ctrl: false, meta: false, alt: false, trusted: true },
      { row: 4, shift: true, ctrl: false, meta: false, alt: false, trusted: true },
      { row: 1, shift: false, ctrl: true, meta: false, alt: false, trusted: true },
      { row: 3, shift: false, ...controlOrMeta, alt: false, trusted: true },
      { row: 5, shift: false, ctrl: false, meta: true, alt: false, trusted: true },
      { row: 5, shift: false, ctrl: false, meta: false, alt: false, trusted: true }
    ])

    // Nothing stays held: the next typed key is a plain lowercase letter.
    await call('browser_click', { workspaceId, tabId, selector: '#after' })
    const pressed = await client.callTool({ name: 'browser_press', arguments: { workspaceId, tabId, key: 'a' } }) as CallToolResult
    expect(pressed.isError, textOf(pressed)).not.toBe(true)
    expect(await call('browser_evaluate', { workspaceId, tabId, script: "JSON.stringify(document.querySelector('#after').value)" })).toBe('a')

    for (const args of [
      { selector: '#row-1', modifiers: ['Shift'] },
      { selector: '#row-1', native: true, doubleClick: true, modifiers: ['Shift'] },
      { x: 20, y: 20, native: true, modifiers: ['Shift'] },
      { selector: '#row-1', native: true, modifiers: ['Alt'] }
    ]) {
      const rejected = await client.callTool({ name: 'browser_click', arguments: { workspaceId, tabId, ...args } }) as CallToolResult
      expect(rejected.isError, JSON.stringify(args)).toBe(true)
    }
    expect((await listState()).events).toHaveLength(6)

    // A Control or Meta click on a link opens it in a new tab of the same workspace.
    const before = (await call<Array<{ id: string }>>('browser_tabs', { workspaceId })).map(tab => tab.id)
    const opened = await click('#link', ['ControlOrMeta'])
    const openedIds = opened.tabsOpenedDuringClick?.tabIds ?? []
    expect(openedIds, JSON.stringify(opened)).toHaveLength(1)
    expect(before).not.toContain(openedIds[0])
    expect((await call<Array<{ id: string }>>('browser_tabs', { workspaceId })).map(tab => tab.id)).toContain(openedIds[0])
    expect(await call('browser_evaluate', { workspaceId, tabId, script: 'JSON.stringify(location.pathname)' })).toBe('/')
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})

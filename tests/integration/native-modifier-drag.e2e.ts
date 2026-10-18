import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

interface DragResult {
  ok?: boolean
  modifiers?: string[]
}

interface PadEvent {
  type: string
  shift: boolean
  alt: boolean
  ctrl: boolean
  meta: boolean
  buttons: number
  trusted: boolean
}

interface DragState {
  events: PadEvent[]
  drops: Array<{ x: number; y: number }>
}

// A canvas-style pad: Shift keeps a drag on its main axis, Alt snaps the drop to a 50px grid.
const PAGE = `<!doctype html><title>Modifier drag fixture</title>
<style>body { margin: 0 } #pad { position: absolute; left: 0; top: 0; width: 400px; height: 300px; user-select: none; touch-action: none; background: #eee }
#from, #to { position: absolute; width: 20px; height: 20px; background: #888 } #from { left: 40px; top: 190px } #to { left: 290px; top: 190px }</style>
<div id="pad"><div id="from"></div><div id="to"></div></div>
<script>
  let start = null
  window.dragState = { events: [], drops: [] }
  const pad = document.querySelector('#pad')
  for (const type of ['pointermove', 'pointerdown', 'pointerup']) pad.addEventListener(type, event => {
    if (type === 'pointermove' && !event.buttons) return
    window.dragState.events.push({ type, shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey, buttons: event.buttons, trusted: event.isTrusted })
    if (type === 'pointerdown') start = { x: event.clientX, y: event.clientY }
    if (type !== 'pointerup' || !start) return
    let x = event.clientX
    let y = event.clientY
    if (event.shiftKey) {
      if (Math.abs(x - start.x) >= Math.abs(y - start.y)) y = start.y; else x = start.x
    }
    if (event.altKey) {
      x = Math.round(x / 50) * 50
      y = Math.round(y / 50) * 50
    }
    window.dragState.drops.push({ x, y })
    start = null
  })
</script>`

test('sends Shift, Alt and ControlOrMeta on every mouse event of one drag, and drags on a locked tab', async ({ appWindow, mcpPort, mcpToken }) => {
  // Verified on Linux; on macOS ControlOrMeta sends Meta.
  test.skip(process.platform !== 'linux', 'Modifier drags are verified on Linux only')
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(PAGE)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Page fixture did not expose a port')
  const client = new Client({ name: 'hronaut-modifier-drag-test', version: '1.0.0' })
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
    const workspaceId = (await call<{ id: string }>('browser_workspaces', { action: 'create', name: 'Modifier drags' })).id
    const tabId = (await call<{ activeTabId: string }>('browser_new_tab', { workspaceId, url: `http://127.0.0.1:${address.port}/` })).activeTabId
    // A drag's pressed moves wait for the page to paint, so the tab is shown.
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    const ready = await client.callTool({ name: 'browser_wait', arguments: { workspaceId, tabId, selector: '#to', state: 'visible' } }) as CallToolResult
    expect(ready.isError, textOf(ready)).not.toBe(true)
    const dragState = () => call<DragState>('browser_evaluate', { workspaceId, tabId, script: 'window.dragState' })
    const resetState = () => call('browser_evaluate', { workspaceId, tabId, script: 'JSON.stringify((window.dragState = { events: [], drops: [] }, true))' })
    // Every pressed pointer event of the drag carries exactly these keys, and the drag starts and ends once.
    const expectDrag = async (keys: Pick<PadEvent, 'shift' | 'alt' | 'ctrl' | 'meta'>, drop: { x: number; y: number }) => {
      const state = await dragState()
      expect(state.events.filter(event => event.type === 'pointerdown')).toHaveLength(1)
      expect(state.events.filter(event => event.type === 'pointerup')).toHaveLength(1)
      expect(state.events.filter(event => event.type === 'pointermove').length).toBeGreaterThan(0)
      for (const event of state.events) expect({ shift: event.shift, alt: event.alt, ctrl: event.ctrl, meta: event.meta, trusted: event.trusted }).toEqual({ ...keys, trusted: true })
      expect(state.drops).toEqual([drop])
      await resetState()
    }
    const coordinateDrag = (modifiers?: string[], endX = 250, endY = 110) =>
      call<DragResult>('browser_drag', { workspaceId, tabId, startX: 50, startY: 50, endX, endY, ...(modifiers ? { modifiers } : {}) })
    const none = { shift: false, alt: false, ctrl: false, meta: false }

    expect(await coordinateDrag()).not.toHaveProperty('modifiers')
    await expectDrag(none, { x: 250, y: 110 })
    expect(await coordinateDrag(['Shift'])).toMatchObject({ ok: true, modifiers: ['Shift'] })
    await expectDrag({ ...none, shift: true }, { x: 250, y: 50 })
    expect(await coordinateDrag(['Alt'], 233, 118)).toMatchObject({ ok: true, modifiers: ['Alt'] })
    await expectDrag({ ...none, alt: true }, { x: 250, y: 100 })
    expect(await coordinateDrag(['ControlOrMeta', 'Shift'])).toMatchObject({ ok: true, modifiers: ['Shift', 'ControlOrMeta'] })
    await expectDrag({ ...none, shift: true, ctrl: true }, { x: 250, y: 50 })

    // An element drag carries the keys too.
    expect(await call<DragResult>('browser_drag', { workspaceId, tabId, sourceSelector: '#from', targetSelector: '#to', modifiers: ['Alt'] }))
      .toMatchObject({ ok: true, modifiers: ['Alt'] })
    await expectDrag({ ...none, alt: true }, { x: 300, y: 200 })

    for (const modifiers of [['Control'], ['Shift', 'Shift'], []]) {
      const rejected = await client.callTool({ name: 'browser_drag', arguments: { workspaceId, tabId, startX: 50, startY: 50, endX: 250, endY: 110, modifiers } }) as CallToolResult
      expect(rejected.isError, JSON.stringify(modifiers)).toBe(true)
    }
    expect((await dragState()).events).toEqual([])

    // The input guard of a tab the person locked admits the agent's pressed moves, with or without keys.
    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(tabId)}, true)`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.humanInteractionLocked)`)).toBe(true)
    await coordinateDrag()
    await expectDrag(none, { x: 250, y: 110 })
    expect(await coordinateDrag(['Shift'])).toMatchObject({ ok: true, modifiers: ['Shift'] })
    await expectDrag({ ...none, shift: true }, { x: 250, y: 50 })
    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(tabId)}, false)`)
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})

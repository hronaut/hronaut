import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

interface DragObservation {
  events: { type: string; target: string; x: number; y: number; scrollY: number }[]
  payload: string | null
}

for (const mode of ['selectors-down', 'selectors-up', 'refs', 'coordinates'] as const) {
  test(`native drag uses endpoints in the same scrolled viewport: ${mode}`, async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
    const reverse = mode === 'selectors-up'
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
      response.end(`<!doctype html><title>Drag scroll fixture</title><style>
        body { margin: 0; height: 2200px }
        #source, #target { position: absolute; box-sizing: border-box }
        #source { left: 100px; top: ${reverse ? 1000 : 800}px; width: 100px; height: 80px; background: coral }
        #target { left: 400px; top: ${reverse ? 800 : 1000}px; width: 160px; height: 120px; background: skyblue }
        </style><div id="source" role="button" aria-label="Drag source" draggable="true">Source</div>
        <div id="target" role="button" aria-label="Drop target">Drop here</div><script>
        window.dragObservation = { events: [], payload: null };
        for (const type of ['pointerdown', 'dragstart', 'drop']) {
          document.addEventListener(type, event => dragObservation.events.push({
            type, target: event.target.id || event.target.tagName,
            x: event.clientX, y: event.clientY, scrollY
          }));
        }
        document.querySelector('#source').addEventListener('dragstart', event => {
          event.dataTransfer.setData('text/plain', 'fixture-payload');
        });
        const target = document.querySelector('#target');
        target.addEventListener('dragover', event => event.preventDefault());
        target.addEventListener('drop', event => {
          event.preventDefault();
          dragObservation.payload = event.dataTransfer.getData('text/plain');
          target.textContent = dragObservation.payload;
        });
        </script>`)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const client = new Client({ name: 'semantic-drag-scroll', version: '1' })
    const call = async (name: string, args: Record<string, unknown>): Promise<string> => {
      const result = await client.callTool({ name, arguments: args }) as CallToolResult
      const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
      expect(result.isError, text).not.toBe(true)
      return text
    }
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture server')
      const url = `http://127.0.0.1:${address.port}/`
      await expect.poll(async () => {
        try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false }
      }).toBe(true)
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
      }))
      const workspace = JSON.parse(await call('browser_workspaces', { action: 'create', name: 'Drag scroll fixture' })) as { id: string }
      const opened = JSON.parse(await call('browser_new_tab', { workspaceId: workspace.id, url, active: true })) as BrowserState
      const args = { workspaceId: workspace.id, tabId: opened.activeTabId }
      await call('browser_wait', { ...args, selector: '#source' })
      await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id!), opened.activeTabId)
      expect(JSON.parse(await call('browser_resize', { ...args, width: 800, height: 640 }))).toMatchObject({ width: 800, height: 640 })
      const page = electronApp.context().pages().find(page => page.url() === url)!
      const points = await page.evaluate(() => {
        scrollTo(0, 700)
        const source = document.querySelector('#source')!.getBoundingClientRect()
        const target = document.querySelector('#target')!.getBoundingClientRect()
        return { startX: source.left + source.width / 2, startY: source.top + source.height / 2,
          endX: target.left + target.width / 2, endY: target.top + target.height / 2 }
      })
      let endpoints: Record<string, unknown> = { sourceSelector: '#source', targetSelector: '#target' }
      if (mode === 'coordinates') endpoints = points
      if (mode === 'refs') {
        await call('browser_snapshot', args)
        endpoints = await page.evaluate(() => ({
          sourceRef: document.querySelector('#source')!.getAttribute('data-hronaut-ref'),
          targetRef: document.querySelector('#target')!.getAttribute('data-hronaut-ref')
        }))
        expect(endpoints.sourceRef).toMatch(/^e\d+$/)
        expect(endpoints.targetRef).toMatch(/^e\d+$/)
      }
      const result = JSON.parse(await call('browser_drag', { ...args, ...endpoints })) as { from: { x: number; y: number }; to: { x: number; y: number } }
      const observed = await page.evaluate(() => (window as unknown as { dragObservation: DragObservation }).dragObservation)
      expect(observed.events.map(event => ({ type: event.type, target: event.target }))).toEqual([
        { type: 'pointerdown', target: 'source' }, { type: 'dragstart', target: 'source' }, { type: 'drop', target: 'target' }
      ])
      expect(observed.payload).toBe('fixture-payload')
      expect(observed.events[0]).toMatchObject({ x: result.from.x, y: result.from.y })
      expect(observed.events[2]).toMatchObject({ x: result.to.x, y: result.to.y })
      if (mode === 'coordinates') {
        expect(result).toMatchObject({ from: { x: points.startX, y: points.startY }, to: { x: points.endX, y: points.endY } })
        expect(observed.events.every(event => event.scrollY === 700)).toBe(true)
      }
    } finally {
      await client.close()
      await closeFixtureServer(server)
    }
  })
}

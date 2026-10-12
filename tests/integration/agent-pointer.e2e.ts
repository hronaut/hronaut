import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ElectronApplication } from '@playwright/test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

async function waitForPointerFixture(client: Client, electronApp: ElectronApplication, tabId: string, url: string): Promise<void> {
  const loaded = await client.callTool({ name: 'browser_wait', arguments: { tabId, timeoutMs: 8_000 } }) as CallToolResult
  expect(loaded.isError, text(loaded)).not.toBe(true)
  const visible = await client.callTool({ name: 'browser_wait', arguments: { tabId, selector: '#action', state: 'visible', timeoutMs: 8_000 } }) as CallToolResult
  expect(visible.isError, text(visible)).not.toBe(true)
  expect(await electronApp.evaluate(async ({ webContents }, pageUrl) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)!
    return { loading: page.isLoadingMainFrame(), document: await page.executeJavaScript(`({ url: location.href, title: document.title, readyState: document.readyState })`) }
  }, url)).toEqual({ loading: false, document: { url, title: 'Agent pointer fixture', readyState: 'complete' } })
}

test('shows agent clicks and hovers without intercepting page input', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>Agent pointer fixture</title>
      <button id="action" style="margin:80px;width:140px;height:50px">Run action</button>
      <button id="hover" style="margin:80px;width:140px;height:50px">Hover target</button>
      <script>
        window.hooks = 0;
        window.pointerEvents = [];
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          document.querySelector('#action').addEventListener(type, (event) => {
            window.pointerEvents.push({ type, trusted: event.isTrusted });
          });
        }
        document.querySelector('#action').addEventListener('click', () => document.body.dataset.clicks = '1');
        const originalQuerySelectorAll = document.querySelectorAll;
        document.querySelectorAll = function (...args) {
          window.hooks++;
          return originalQuerySelectorAll.apply(this, args);
        };
      </script>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Agent pointer fixture did not expose a port')
  const url = `http://127.0.0.1:${address.port}/pointer`
  const client = new Client({ name: 'hronaut-agent-pointer-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
  })

  try {
    await expect.poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, {
          headers: { authorization: `Bearer ${mcpToken}` }
        })).ok
      } catch {
        return false
      }
    }).toBe(true)
    await client.connect(transport)
    await useMcpWorkspace(client, 'Agent pointer test', false)
    const opened = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url, active: true }
    }) as CallToolResult
    expect(opened.isError, text(opened)).not.toBe(true)
    const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)

    // Selection may finish before the first document commits; establish the intended target before native input.
    await waitForPointerFixture(client, electronApp, tabId, url)

    const click = await client.callTool({
      name: 'browser_click',
      arguments: { tabId, selector: '#action', native: true }
    }) as CallToolResult
    expect(click.isError, text(click)).not.toBe(true)
    const clicked = await electronApp.evaluate(async ({ webContents }, pageUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)!
      return page.executeJavaScript(`(() => {
        const pointer = document.querySelector('[data-hronaut-agent-pointer]');
        return {
          clicks: document.body.dataset.clicks,
          events: window.pointerEvents,
          count: pointer ? 1 : 0,
          hooks: window.hooks,
          opacity: pointer?.style.opacity,
          pointerEvents: pointer?.style.pointerEvents,
          shadowRoot: pointer?.shadowRoot ?? null
        };
      })()`)
    }, url)
    expect(clicked).toEqual({
      clicks: '1',
      events: [
        { type: 'pointerdown', trusted: true },
        { type: 'mousedown', trusted: true },
        { type: 'pointerup', trusted: true },
        { type: 'mouseup', trusted: true },
        { type: 'click', trusted: true }
      ],
      count: 1,
      hooks: 0,
      opacity: '1',
      pointerEvents: 'none',
      shadowRoot: null
    })

    const hover = await client.callTool({
      name: 'browser_hover',
      arguments: { tabId, selector: '#hover' }
    }) as CallToolResult
    expect(hover.isError, text(hover)).not.toBe(true)
    const pointerCount = await electronApp.evaluate(async ({ webContents }, pageUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)!
      return page.executeJavaScript(`({ count: document.querySelector('[data-hronaut-agent-pointer]') ? 1 : 0, hooks: window.hooks })`)
    }, url)
    expect(pointerCount).toEqual({ count: 1, hooks: 0 })
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})


type InitialDocumentGate = { documentListeners: number; commits: number; mouseEvents: string[]; contentsId: number; restore(): void }
type InitialDocumentGlobal = typeof globalThis & { __initialDocumentClick?: InitialDocumentGate }

for (const readyBeforeClick of [false, true]) {
  test(`initial document commit ${readyBeforeClick ? 'settles before' : 'invalidates'} native click preparation`, async ({ electronApp, mcpPort, mcpToken }, info) => {
    let releaseResponse!: () => void
    const responseGate = new Promise<void>(resolve => { releaseResponse = resolve })
    let requested = false
    const server = createServer(async (_request, response) => {
      requested = true
      await responseGate
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
      response.end(`<title>Agent pointer fixture</title><button id="action" style="margin:80px;width:140px;height:50px">Run action</button><script>
        window.pointerEvents=[];
        for(const type of ['pointerdown','mousedown','pointerup','mouseup','click']) document.querySelector('#action').addEventListener(type,event=>window.pointerEvents.push({type,trusted:event.isTrusted}));
      </script>`)
    })
    const client = new Client({ name: 'initial-document-click-test', version: '1' })
    let pending: Promise<CallToolResult> | undefined
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing controlled fixture address')
      const url = `http://127.0.0.1:${address.port}/pointer`
      await expect.poll(async () => {
        try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok }
        catch { return false }
      }).toBe(true)
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
      }))
      await useMcpWorkspace(client, 'Initial document click', false)
      const existing = await electronApp.evaluate(({ webContents }) => webContents.getAllWebContents().map(contents => contents.id))
      const opened = await client.callTool({ name: 'browser_new_tab', arguments: { url, active: true } }) as CallToolResult
      expect(opened.isError, text(opened)).not.toBe(true)
      const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
      await expect.poll(() => requested).toBe(true)
      await electronApp.evaluate(({ webContents }, existingIds) => {
        const candidates = webContents.getAllWebContents().filter(contents => !existingIds.includes(contents.id))
        if (candidates.length !== 1) throw new Error('Expected exactly one new controlled fixture WebContents')
        const page = candidates[0]!
        const execute = page.executeJavaScript
        const send = page.debugger.sendCommand
        const committed = (): void => { gate.commits++ }
        const gate: InitialDocumentGate = {
          documentListeners: page.listenerCount('did-navigate') + 1, commits: 0, mouseEvents: [], contentsId: page.id,
          restore: () => {
            page.removeListener('did-navigate', committed)
            if (!page.isDestroyed()) { page.executeJavaScript = execute; page.debugger.sendCommand = send }
          }
        }
        ;(globalThis as InitialDocumentGlobal).__initialDocumentClick = gate
        page.on('did-navigate', committed)
        page.debugger.sendCommand = async (method, ...args) => {
          if (method === 'Input.dispatchMouseEvent' && gate.mouseEvents.length < 10) gate.mouseEvents.push(String(args[0]?.type))
          return send.call(page.debugger, method, ...args)
        }
      }, existing)
      if (readyBeforeClick) {
        releaseResponse()
        await waitForPointerFixture(client, electronApp, tabId, url)
      }
      pending = client.callTool({ name: 'browser_click', arguments: { tabId, selector: '#action', native: true } }) as Promise<CallToolResult>
      if (!readyBeforeClick) {
        // Native original retention now precedes scroll preparation. Observe
        // the operation-owned authority listener before committing the held load.
        await expect.poll(() => electronApp.evaluate(({ webContents }) => {
          const gate = (globalThis as InitialDocumentGlobal).__initialDocumentClick!
          return webContents.fromId(gate.contentsId)!.listenerCount('did-navigate') - gate.documentListeners
        })).toBe(1)
        await info.attach('initial-document-boundary', { body: JSON.stringify({ authorityListenerInstalled: true, responseHeld: true }), contentType: 'application/json' })
        releaseResponse()
      }
      const result = await pending
      const observed = await electronApp.evaluate(async ({ webContents }) => {
        const gate = (globalThis as InitialDocumentGlobal).__initialDocumentClick!
        const page = webContents.fromId(gate.contentsId)!
        return { commits: gate.commits, mouseEvents: gate.mouseEvents, listenerDelta: page.listenerCount('did-navigate') - gate.documentListeners, pageEvents: await page.executeJavaScript('window.pointerEvents') }
      })
      await info.attach('initial-document-outcome', { body: JSON.stringify({ result, observed }), contentType: 'application/json' })
      expect(observed.commits).toBe(1)
      expect(observed.listenerDelta).toBe(0)
      if (readyBeforeClick) {
        expect(result.isError, text(result)).not.toBe(true)
        expect(observed.mouseEvents).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased'])
        expect(observed.pageEvents).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].map(type => ({ type, trusted: true })))
      } else {
        expect(result.isError, text(result)).toBe(true)
        expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false })
        expect(observed.mouseEvents).toEqual([])
        expect(observed.pageEvents).toEqual([])
      }
    } finally {
      releaseResponse()
      await pending?.catch(() => undefined)
      await electronApp.evaluate(() => {
        const scope = globalThis as InitialDocumentGlobal
        scope.__initialDocumentClick?.restore()
        delete scope.__initialDocumentClick
      }).catch(() => undefined)
      await client.close().catch(() => undefined)
      await closeFixtureServer(server)
    }
  })
}

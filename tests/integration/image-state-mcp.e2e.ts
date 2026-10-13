import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState, HronautApi, HronautSettingsApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, expectFixtureSuccess, test } from './fixtures.js'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const text = (result: CallToolResult) => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
test('reports bounded hidden image state without page getters, source metadata, follow selection or waking', async ({ electronApp, appWindow, mcpPort, mcpToken }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><img id="target" hidden src="data:image/png,PRIVATE_IMAGE_SOURCE_CANARY"><img id="other" role="button" tabindex="0" aria-label="Synthetic image"><div id="ordinary"></div><script>
      const target=document.getElementById('target');
      globalThis.getterCalls=0;globalThis.methodCalls=0;globalThis.domChanges=0;globalThis.focuses=0;
      for(const name of ['complete','naturalWidth','naturalHeight','currentSrc']){
        const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,name);
        Object.defineProperty(HTMLImageElement.prototype,name,{get(){getterCalls++;throw Error('PRIVATE_IMAGE_SOURCE_CANARY')},set:descriptor.set,configurable:true});
        Object.defineProperty(target,name,{get(){getterCalls++;throw Error('PRIVATE_IMAGE_SOURCE_CANARY')},configurable:true});
      }
      for(const name of ['decode'])target[name]=()=>{methodCalls++;throw Error('unexpected image mutation')};
      document.addEventListener('focus',()=>focuses++,true);new MutationObserver(()=>domChanges++).observe(document,{subtree:true,childList:true,attributes:true});
    </script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  const client = new Client({ name: 'image-state-proof', version: '1' })
  const received: string[] = []
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } })
    await client.connect(transport)
    const onmessage = transport.onmessage!
    transport.onmessage = message => { received.push(JSON.stringify(message)); onmessage(message) }
    const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
    const created = await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Image scalar proof' }); expectFixtureSuccess(created, 'workspace')
    const workspace = JSON.parse(text(created)) as { id: string }
    const opened = await call('browser_new_tab', { workspaceId: workspace.id, url }); expectFixtureSuccess(opened, 'tab')
    const tabId = (JSON.parse(text(opened)) as BrowserState).activeTabId!
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(page => page.getURL() === url && !page.isLoading()), url)).toBe(true)
    const onPage = (code: string) => electronApp.evaluate(async ({ webContents }, { url, code }) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript(code, false), { url, code })
    await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      const original = page.executeJavaScriptInIsolatedWorld
      const witness = { clean: true, observations: 0 }
      ;(globalThis as typeof globalThis & { imageRawWitness?: typeof witness; restoreImageWitness?: () => void }).imageRawWitness = witness
      ;(globalThis as typeof globalThis & { restoreImageWitness?: () => void }).restoreImageWitness = () => { page.executeJavaScriptInIsolatedWorld = original }
      page.executeJavaScriptInIsolatedWorld = async function (...args) {
        const result = await original.apply(this, args)
        if (args[0] === 1022) {
          const serialized = JSON.stringify(result)
          witness.observations++
          witness.clean &&= serialized.length <= 512 && !/PRIVATE_IMAGE_SOURCE_CANARY|currentSrc|blob:|data:image|message/.test(serialized)
        }
        return result
      }
    }, url)
    const inspect = (extra: Record<string, unknown> = {}) => call('browser_image_state', { workspaceId: workspace.id, tabId, selector: '#target', ...extra })
    const witness = '({getterCalls,methodCalls,domChanges,focuses,x:scrollX,y:scrollY,focused:document.activeElement===document.body})'
    const before = await onPage(witness)
    for (let index = 0; index < 3; index++) {
      const report = await inspect(); expect(report.isError, text(report)).not.toBe(true)
      expect(JSON.parse(text(report))).toMatchObject({ complete: true, naturalWidth: 0, naturalHeight: 0, hasSelectedSource: true })
      expect(text(report).length).toBeLessThan(512)
      expect(text(report)).not.toMatch(/currentSrc|title|url|message/)
    }
    expect(await onPage(witness)).toEqual(before)
    await onPage("new Promise(resolve=>{const image=document.getElementById('target');image.onload=image.onerror=()=>resolve(true);image.src='data:image/png,PRIVATE_IMAGE_SOURCE_CANARY'+ 'x'.repeat(2*1024*1024)})")
    const largeSource = await inspect()
    expect(largeSource.isError, text(largeSource)).not.toBe(true)
    expect(JSON.parse(text(largeSource))).toMatchObject({ complete: true, naturalWidth: 0, hasSelectedSource: true })
    expect(text(largeSource).length).toBeLessThan(512)
    for (const selector of ['#missing', '#ordinary', 'img', '[', '', ' '.repeat(1001), true, 1]) expect((await inspect({ selector })).isError).toBe(true)
    expect(text(await inspect({ selector: '#ordinary' }))).toContain('Image state unsupported')
    expect(text(await inspect({ selector: '#missing' }))).toContain('target not found')
    // Refs are rejected regardless of selector; generating one must not require
    // a separate page-wide observation in this source-privacy fixture.
    await onPage("document.getElementById('other').setAttribute('data-hronaut-ref','image-ref');void 0")
    const ref = 'image-ref'
    expect(typeof ref).toBe('string')
    const byRef = await inspect({ ref, selector: undefined })
    expect(byRef.isError).toBe(true)
    expect(text(byRef)).toContain('ref')
    expect((await inspect({ ref, selector: '#other' })).isError).toBe(true)
    const bySelector = await inspect({ selector: '#other' })
    expectFixtureSuccess(bySelector, 'explicit current image selector')
    expect(JSON.parse(text(bySelector)).complete).toBe(true)
    await onPage("document.getElementById('other').remove();void 0")
    expect((await inspect({ ref, selector: undefined })).isError).toBe(true)
    const foreign = JSON.parse(text(await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Other authorized workspace' }))) as { id: string }
    expect((await inspect({ workspaceId: foreign.id })).isError).toBe(true)
    const other = JSON.parse(text(await call('browser_new_tab', { workspaceId: workspace.id, url: 'about:blank', active: true }))) as BrowserState
    await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.setFollowAgentActivity(true))
    expect((await inspect()).isError).not.toBe(true)
    expect((JSON.parse(text(await call('browser_status', { workspaceId: workspace.id }))) as BrowserState).activeTabId).toBe(other.activeTabId)
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabPageLifecycle(id, 'frozen'), tabId)
    expect((await inspect()).isError).toBe(true)
    expect((JSON.parse(text(await call('browser_status', { workspaceId: workspace.id }))) as BrowserState).tabs.find(tab => tab.id === tabId)?.pageLifecycleState).toBe('frozen')
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabPageLifecycle(id, 'active'), tabId)
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabSleeping(id, true), tabId)
    expect((await inspect()).isError).toBe(true)
    const after = JSON.parse(text(await call('browser_status', { workspaceId: workspace.id }))) as BrowserState
    expect(after.tabs.find(tab => tab.id === tabId)?.sleeping).toBe(true)
    expect(after.activeTabId).toBe(other.activeTabId)
    expect(received.join('\n')).not.toContain('PRIVATE_IMAGE_SOURCE_CANARY')
    const rawWitness = await electronApp.evaluate(() => (globalThis as typeof globalThis & { imageRawWitness?: { clean: boolean; observations: number } }).imageRawWitness)
    expect(rawWitness?.clean).toBe(true)
    expect(rawWitness?.observations).toBeGreaterThan(3)
  } finally {
    await electronApp.evaluate(() => (globalThis as typeof globalThis & { restoreImageWitness?: () => void }).restoreImageWitness?.()).catch(() => undefined)
    await client.close().catch(() => undefined); await closeFixtureServer(server) }
})

import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState, HronautApi, HronautSettingsApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, expectFixtureSuccess, test } from './fixtures.js'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const text = (result: CallToolResult) => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
test('reports bounded hidden media state without page getters, source metadata, follow selection or waking', async ({ electronApp, appWindow, mcpPort, mcpToken }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><audio id="target" hidden></audio><video id="other" controls role="button" tabindex="0" aria-label="Synthetic player"></video><div id="ordinary"></div><script>
      globalThis.getterCalls=0;globalThis.methodCalls=0;globalThis.domChanges=0;globalThis.focuses=0;
      for(const name of ['paused','ended','seeking','muted','volume','playbackRate','currentTime','duration','readyState','networkState','error','currentSrc']){
        const descriptor=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,name);
        Object.defineProperty(HTMLMediaElement.prototype,name,{get(){getterCalls++;throw Error('PRIVATE_MEDIA_SOURCE_CANARY')},set:descriptor.set,configurable:true});
        Object.defineProperty(target,name,{get(){getterCalls++;throw Error('PRIVATE_MEDIA_SOURCE_CANARY')},configurable:true});
      }
      for(const name of ['play','pause','load'])target[name]=()=>{methodCalls++;throw Error('unexpected media mutation')};
      document.addEventListener('focus',()=>focuses++,true);new MutationObserver(()=>domChanges++).observe(document,{subtree:true,childList:true,attributes:true});
    </script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  const client = new Client({ name: 'media-state-proof', version: '1' })
  const received: string[] = []
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } })
    await client.connect(transport)
    const onmessage = transport.onmessage!
    transport.onmessage = message => { received.push(JSON.stringify(message)); onmessage(message) }
    const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
    const created = await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Media scalar proof' }); expectFixtureSuccess(created, 'workspace')
    const workspace = JSON.parse(text(created)) as { id: string }
    const opened = await call('browser_new_tab', { workspaceId: workspace.id, url }); expectFixtureSuccess(opened, 'tab')
    const tabId = (JSON.parse(text(opened)) as BrowserState).activeTabId!
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(page => page.getURL() === url && !page.isLoading()), url)).toBe(true)
    const onPage = (code: string) => electronApp.evaluate(async ({ webContents }, { url, code }) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript(code, false), { url, code })
    await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      const original = page.executeJavaScriptInIsolatedWorld
      const witness = { clean: true, observations: 0 }
      ;(globalThis as typeof globalThis & { mediaRawWitness?: typeof witness; restoreMediaWitness?: () => void }).mediaRawWitness = witness
      ;(globalThis as typeof globalThis & { restoreMediaWitness?: () => void }).restoreMediaWitness = () => { page.executeJavaScriptInIsolatedWorld = original }
      page.executeJavaScriptInIsolatedWorld = async function (...args) {
        const result = await original.apply(this, args)
        if (args[0] === 1020) {
          const serialized = JSON.stringify(result)
          witness.observations++
          witness.clean &&= serialized.length <= 1024 && !/PRIVATE_MEDIA_SOURCE_CANARY|currentSrc|blob:|data:audio|message/.test(serialized)
        }
        return result
      }
    }, url)
    const inspect = (extra: Record<string, unknown> = {}) => call('browser_media_state', { workspaceId: workspace.id, tabId, selector: '#target', ...extra })
    const witness = '({getterCalls,methodCalls,domChanges,focuses,x:scrollX,y:scrollY,focused:document.activeElement===document.body})'
    const before = await onPage(witness)
    for (let index = 0; index < 3; index++) {
      const report = await inspect(); expect(report.isError, text(report)).not.toBe(true)
      expect(JSON.parse(text(report))).toMatchObject({ kind: 'audio', paused: true, ended: false, seeking: false, muted: false, volume: 1, currentTime: 0, duration: { state: 'unknown' }, readyState: 0, networkState: 0, errorCode: null })
      expect(text(report).length).toBeLessThan(1024)
      expect(text(report)).not.toMatch(/currentSrc|source|title|url|message/)
    }
    expect(await onPage(witness)).toEqual(before)
    for (const selector of ['#missing', '#ordinary', 'audio,video', '[']) expect((await inspect({ selector })).isError).toBe(true)
    expect(text(await inspect({ selector: '#ordinary' }))).toContain('Media state unsupported')
    expect(text(await inspect({ selector: '#missing' }))).toContain('one unique current target')
    const snapshot = await call('browser_snapshot', { workspaceId: workspace.id, tabId })
    expectFixtureSuccess(snapshot, 'current media ref snapshot')
    const ref = await onPage("document.getElementById('other').getAttribute('data-hronaut-ref')")
    expect(typeof ref).toBe('string')
    const byRef = await inspect({ ref, selector: undefined })
    expectFixtureSuccess(byRef, 'native media current ref')
    expect(JSON.parse(text(byRef)).kind).toBe('video')
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
    expect(received.join('\n')).not.toContain('PRIVATE_MEDIA_SOURCE_CANARY')
    const rawWitness = await electronApp.evaluate(() => (globalThis as typeof globalThis & { mediaRawWitness?: { clean: boolean; observations: number } }).mediaRawWitness)
    expect(rawWitness?.clean).toBe(true)
    expect(rawWitness?.observations).toBeGreaterThan(3)
  } finally {
    await electronApp.evaluate(() => (globalThis as typeof globalThis & { restoreMediaWitness?: () => void }).restoreMediaWitness?.()).catch(() => undefined)
    await client.close().catch(() => undefined); await closeFixtureServer(server) }
})

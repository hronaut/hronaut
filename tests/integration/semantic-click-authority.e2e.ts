import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type Gate = {
  ready: boolean
  acknowledged: boolean
  dispatches: number
  mouseCommands: number
  listeners: number
  release(): void
  restore(): void
}
type Scope = typeof globalThis & { __semanticClickGate?: Gate }

const cases = [
  ['input', 'unchanged', 'selector', false], ['input', 'unchanged', 'ref', false],
  ['input', 'pause', 'selector', false], ['input', 'pause', 'ref', false],
  ['input', 'pause ABA', 'selector', false], ['input', 'navigation', 'ref', false],
  ['input', 'navigation', 'selector', false], ['pointer', 'pause', 'ref', false],
  ['pointer', 'navigation', 'selector', false], ['input', 'global pause ABA', 'selector', false],
  ['input', 'workspace access ABA', 'ref', false], ['input', 'cancel', 'selector', false],
  ['context', 'unchanged', 'selector', true], ['context', 'unchanged', 'ref', true],
  ['context', 'unchanged', 'coordinates', true], ['context', 'pause', 'selector', true],
  ['context', 'pause ABA', 'ref', true], ['context', 'navigation', 'coordinates', true]
] as const

for (const [phase, change, target, dialog] of cases) {
  test(`semantic click ${phase}: ${change}, ${target}, dialog ${dialog}`, async ({ capabilities, electronApp, appWindow }, testInfo) => {
    const { client, tabId, fixtureUrl } = capabilities
    await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      await page.executeJavaScript(`document.body.innerHTML='<button id="target" style="position:fixed;left:100px;top:100px;width:150px;height:80px">Synthetic target</button>';window.semanticClicks=0;window.syntheticConfirmation=null;document.querySelector('#target').onclick=()=>{window.semanticClicks++;window.syntheticConfirmation=confirm('Synthetic confirmation')};void 0;`)
    }, fixtureUrl)
    // Ordinary controls must not open a blocking dialog.
    if (!dialog) await electronApp.evaluate(async ({ webContents }, url) => {
      await webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript("document.querySelector('#target').onclick=()=>window.semanticClicks++;void 0;")
    }, fixtureUrl)
    let ref: string | undefined
    if (target === 'ref') {
      expect((await client.callTool({ name: 'browser_snapshot', arguments: { tabId } })).isError).not.toBe(true)
      ref = await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript("document.querySelector('#target').getAttribute('data-hronaut-ref')"), fixtureUrl)
      expect(ref).toBeTruthy()
    }
    await electronApp.evaluate(({ webContents }, { url, phase }) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      const execute = page.executeJavaScript
      const api = page.debugger
      const send = api.sendCommand
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const gate: Gate = {
        ready: false, acknowledged: false, dispatches: 0, mouseCommands: 0,
        listeners: page.listenerCount('did-navigate'), release,
        restore: () => { if (!page.isDestroyed()) { page.executeJavaScript = execute; api.sendCommand = send } }
      }
      ;(globalThis as Scope).__semanticClickGate = gate
      const hold = async (): Promise<void> => {
        if (gate.ready) return
        gate.acknowledged = true
        gate.ready = true
        await barrier
      }
      page.executeJavaScript = async (script, ...args) => {
        if (script.includes('element.click();')) gate.dispatches++
        const result = await execute.call(page, script, ...args)
        if ((phase === 'input' && script === 'window.__hronautAgentInputActive = true')
          || (phase === 'pointer' && script.includes('element.scrollIntoView') && !script.includes('element.click();'))) await hold()
        return result
      }
      api.sendCommand = async (method, ...args) => {
        const params = args[0] as { expression?: string } | undefined
        if (method === 'Input.dispatchMouseEvent') gate.mouseCommands++
        if (method === 'Runtime.evaluate' && (params?.expression?.includes('element.click();') || params?.expression?.includes("new MouseEvent('click'"))) gate.dispatches++
        const result = await send.call(api, method, ...args)
        if (phase === 'context' && method === 'Page.getFrameTree') await hold()
        return result
      }
    }, { url: fixtureUrl, phase })
    const abort = new AbortController()
    const transport = client.transport!
    const send = transport.send.bind(transport)
    let requestId: string | number | undefined
    transport.send = async (message, options) => {
      if ('method' in message && message.method === 'tools/call' && 'id' in message && message.params?.name === 'browser_click') requestId = message.id
      return send(message, options)
    }
    let pending: Promise<CallToolResult> | undefined
    try {
      pending = client.callTool({ name: 'browser_click', arguments: {
        tabId, ...(target === 'coordinates' ? { x: 150, y: 140 } : target === 'ref' ? { ref } : { selector: '#target' }),
        ...(dialog ? { dialogAction: 'accept' } : {})
      } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>
      if (change === 'cancel') pending = pending.catch(() => ({ isError: true, content: [{ type: 'text', text: 'Client cancelled' }] }))
      await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__semanticClickGate?.ready)).toBe(true)
      if (change === 'pause' || change === 'pause ABA') await appWindow.evaluate(async ({ id, resume }) => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        await api.setTabAgentPaused(id, true)
        if (resume) await api.setTabAgentPaused(id, false)
      }, { id: tabId, resume: change === 'pause ABA' })
      if (change === 'global pause ABA') await appWindow.evaluate('window.hronautMcp.setPaused(true).then(()=>window.hronautMcp.setPaused(false))')
      if (change === 'workspace access ABA') await appWindow.evaluate(async id => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        const workspaceId = (await api.getState()).tabs.find(tab => tab.id === id)!.mcpGroupId!
        await api.updateTabGroup(workspaceId, { agentAccess: false })
        await api.updateTabGroup(workspaceId, { agentAccess: true })
      }, tabId)
      if (change === 'navigation') await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
        await page.executeJavaScript("location.hash='new-context'")
      }, fixtureUrl)
      if (change === 'cancel') {
        if (requestId === undefined) throw new Error('Missing synthetic click request id')
        await client.notification({ method: 'notifications/cancelled', params: { requestId, reason: 'Synthetic cancellation' } })
        abort.abort()
      }
      await electronApp.evaluate(() => (globalThis as Scope).__semanticClickGate!.release())
      const result = await pending
      let terminalActivity: unknown
      if (change === 'cancel') await expect.poll(async () => {
        terminalActivity = await electronApp.evaluate(async ({ webContents }, id) => {
          const home = webContents.getAllWebContents().find(page => page.getURL().startsWith('hronaut://home'))!
          const response = await home.session.fetch('hronaut://home/api/status')
          if (!response.ok) throw new Error(`Activity observation failed: ${response.status}`)
          const state = await response.json() as { recentActivity: { tabId: string; toolName: string; result: unknown }[] }
          return state.recentActivity.find(activity => activity.tabId === id && activity.toolName === 'browser_click')?.result
        }, tabId)
        return terminalActivity
      }).toMatchObject({ dispatch: 'dispatched', effects: 'possible', outcome: 'cancelled' })
      const observation = await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(page => page.getURL().split('#')[0] === url)!
        const gate = (globalThis as Scope).__semanticClickGate!
        return {
          acknowledged: gate.acknowledged, dispatches: gate.dispatches, mouseCommands: gate.mouseCommands,
          listenersRestored: page.listenerCount('did-navigate') === gate.listeners,
          effects: await page.executeJavaScript('({clicks:window.semanticClicks,confirmation:window.syntheticConfirmation,active:window.__hronautAgentInputActive===true})')
        }
      }, fixtureUrl)
      await testInfo.attach('semantic-click-authority', { body: JSON.stringify({ phase, change, target, dialog, result, terminalActivity, observation }), contentType: 'application/json' })
      const count = change === 'unchanged' ? 1 : 0
      expect(observation).toMatchObject({ acknowledged: true, dispatches: count, mouseCommands: 0, listenersRestored: true, effects: { clicks: count, active: false } })
      expect(result.isError === true, text(result)).toBe(change !== 'unchanged')
      if (change !== 'unchanged' && change !== 'cancel') expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false })
      if (dialog && change === 'unchanged') expect(observation.effects.confirmation).toBe(true)
    } finally {
      transport.send = send
      await electronApp.evaluate(() => {
        const scope = globalThis as Scope
        scope.__semanticClickGate?.release()
        scope.__semanticClickGate?.restore()
        delete scope.__semanticClickGate
      }).catch(() => undefined)
      await pending?.catch(() => undefined)
    }
  })
}

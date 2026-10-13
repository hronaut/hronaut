import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

for (const mode of ['unlocked-custom', 'locked-custom', 'locked-no-handler', 'unlocked-no-handler'] as const) {
  test(`diagnostic trusted right click: ${mode}`, async ({ capabilities, electronApp, appWindow }, testInfo) => {
    const { client, tabId, fixtureUrl } = capabilities
    const locked = mode.startsWith('locked-')
    const custom = mode.endsWith('-custom')
    await electronApp.evaluate(async ({ webContents, Menu }, { url, custom }) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      const scope = globalThis as typeof globalThis & { __rightClickProbe?: boolean; __rightClickEvidence?: unknown }
      scope.__rightClickProbe = true
      const events: unknown[] = []
      let popups = 0
      const popup = Menu.prototype.popup
      Menu.prototype.popup = function (...args) { popups++; const result = popup.apply(this, args); setTimeout(() => this.closePopup(), 100); return result }
      page.on('before-mouse-event', (event, mouse) => events.push({ ...mouse, prevented: event.defaultPrevented }))
      page.on('context-menu', (event, params) => events.push({ type: 'app-context-menu', prevented: event.defaultPrevented, x: params.x, y: params.y }))
      scope.__rightClickEvidence = { events, get popups() { return popups }, restore: () => { Menu.prototype.popup = popup } }
      await page.executeJavaScript(`document.body.innerHTML='<button id="target" style="position:fixed;left:100px;top:100px;width:180px;height:80px">Open menu</button><button id="item" hidden style="position:fixed;left:310px;top:100px;width:180px;height:80px">Choose item</button><button id="ordinary" style="position:fixed;left:100px;top:250px;width:180px;height:60px">Ordinary input</button>';window.rightEvidence={events:[],opened:0,selected:0};for(const type of ['mousedown','mouseup','contextmenu','click','keydown','keyup'])document.addEventListener(type,event=>rightEvidence.events.push({type,trusted:event.isTrusted,button:event.button,target:event.target.id}));document.querySelector('#item').onclick=()=>rightEvidence.selected++;${custom ? "document.querySelector('#target').addEventListener('contextmenu',event=>{event.preventDefault();rightEvidence.opened++;document.querySelector('#item').hidden=false})" : ''};void 0`)
    }, { url: fixtureUrl, custom })
    if (locked) await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, true), tabId)
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      return result
    }
    try {
      const result = await call('browser_click', { selector: '#target', native: true })
      const opening = await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
        const evidence = (globalThis as typeof globalThis & { __rightClickEvidence: { events: unknown[]; popups: number } }).__rightClickEvidence
        return { native: evidence.events, popups: evidence.popups, dom: await page.executeJavaScript('window.rightEvidence'), versions: process.versions }
      }, fixtureUrl)
      await testInfo.attach('opening', { body: JSON.stringify({ mode, result, opening }), contentType: 'application/json' })
      console.log(JSON.stringify({ probe: 'opening', mode, result, opening }))
      expect(opening.popups).toBe(!locked && !custom ? 1 : 0)
      expect(opening.dom.selected).toBe(0)
      const expectContext = true
      expect(opening.dom.opened).toBe(custom && expectContext ? 1 : 0)
      expect(opening.dom.events.filter((event: { type: string; trusted: boolean }) => event.type === 'mousedown' || event.type === 'mouseup')).toEqual([
        { type: 'mousedown', trusted: true, button: 2, target: 'target' },
        { type: 'mouseup', trusted: true, button: 2, target: 'target' }
      ])
      await electronApp.evaluate(() => { (globalThis as typeof globalThis & { __rightClickProbe?: boolean }).__rightClickProbe = false })
      if (opening.dom.opened) await call('browser_click', { selector: '#item', native: true })
      await call('browser_click', { selector: '#ordinary', native: true })
      await call('browser_press', { key: 'x' })
      const after = await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('({selected:window.rightEvidence.selected,value:document.querySelector("#ordinary").value,events:window.rightEvidence.events})'), fixtureUrl)
      expect(after.selected).toBe(opening.dom.opened ? 1 : 0)
      expect(after.events.some((event: { type: string; trusted: boolean; target: string }) => event.type === 'keydown' && event.trusted && event.target === 'ordinary')).toBe(true)
      console.log(JSON.stringify({ probe: 'after', mode, after }))
      await testInfo.attach('after-separate-input', { body: JSON.stringify(after), contentType: 'application/json' })
    } finally {
      await electronApp.evaluate(() => {
        const scope = globalThis as typeof globalThis & { __rightClickProbe?: boolean; __rightClickEvidence?: { restore(): void } }
        scope.__rightClickEvidence?.restore(); delete scope.__rightClickEvidence; delete scope.__rightClickProbe
      }).catch(() => undefined)
    }
  })
}

type Gate = { held: boolean; commands: string[]; popups: number; release(): void; restore(): void }
type Scope = typeof globalThis & { __rightClickProbe?: boolean; __rightGate?: Gate }

for (const phase of ['move', 'press'] as const) for (const change of ['cancel', 'disconnect', 'unlock', 'pause', 'lost-ack'] as const) {
  test(`diagnostic right-click authority: ${phase} ${change}`, async ({ capabilities, electronApp, appWindow, mcpPort, mcpToken }, info) => {
    const { client, tabId, fixtureUrl } = capabilities
    await electronApp.evaluate(async ({ webContents, Menu }, { url, phase, change }) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      await page.executeJavaScript("document.body.innerHTML='<button id=target style=\"position:fixed;left:100px;top:100px;width:180px;height:80px\">Target</button>';window.authorityEvents=[];for(const type of ['mousedown','mouseup','contextmenu'])document.addEventListener(type,event=>authorityEvents.push({type,trusted:event.isTrusted,button:event.button}));void 0")
      const send = page.debugger.sendCommand
      const popup = Menu.prototype.popup
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const gate: Gate = { held: false, commands: [], popups: 0, release, restore: () => { page.debugger.sendCommand = send; Menu.prototype.popup = popup } }
      const scope = globalThis as Scope
      scope.__rightClickProbe = true; scope.__rightGate = gate
      Menu.prototype.popup = function (...args) { gate.popups++; const result = popup.apply(this, args); setTimeout(() => this.closePopup(), 100); return result }
      page.debugger.sendCommand = async (method, ...args) => {
        const params = args[0] as Record<string, unknown> | undefined
        if (method === 'Input.dispatchMouseEvent') gate.commands.push(String(params?.type) + ':' + String(params?.button))
        const result = await send.call(page.debugger, method, ...args)
        if (!gate.held && method === 'Input.dispatchMouseEvent' && params?.type === (phase === 'press' ? 'mousePressed' : 'mouseMoved')) { gate.held = true; await barrier; if (change === 'lost-ack') throw new Error('Controlled lost native acknowledgement') }
        return result
      }
    }, { url: fixtureUrl, phase, change })
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, true), tabId)
    const transport = client.transport!
    const send = transport.send.bind(transport)
    let requestId: string | number | undefined
    transport.send = async (message, options) => {
      if ('method' in message && message.method === 'tools/call' && 'id' in message && message.params?.name === 'browser_click') requestId = message.id
      return send(message, options)
    }
    const abort = new AbortController()
    let replacement: Client | undefined
    const pending = client.callTool({ name: 'browser_click', arguments: { tabId, selector: '#target', native: true } }, undefined, { signal: abort.signal }).catch(() => undefined)
    try {
      await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__rightGate!.held)).toBe(true)
      if (change === 'unlock') {
        await expect(appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, false), tabId)).rejects.toThrow('A page is busy')
        expect(await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(tab => tab.id === id)!.humanInteractionLocked, tabId)).toBe(true)
      }
      if (change === 'pause') await appWindow.evaluate('window.hronautMcp.setPaused(true)')
      let ownership: unknown
      if (change === 'cancel' || change === 'disconnect') {
        await client.notification({ method: 'notifications/cancelled', params: { requestId: requestId!, reason: 'Synthetic right-click ownership probe' } })
        abort.abort(); await pending
        const workspaceId = await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(tab => tab.id === id)!.mcpGroupId!, tabId)
        ownership = await client.callTool({ name: 'browser_workspaces', arguments: { action: 'ownership-status', workspaceId } })
        if (change === 'disconnect') {
          await (transport as StreamableHTTPClientTransport).terminateSession()
          replacement = new Client({ name: 'right-click-replacement', version: '1' })
          await replacement.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
          await connectMcpWorkspace(replacement, 'Right-click reconnect', false, capabilities.workspace)
          ownership = await replacement.callTool({ name: 'browser_workspaces', arguments: { action: 'ownership-status', workspaceId } })
          console.log(JSON.stringify({ probe: 'disconnected-ownership', phase, ownership }))
          expect(JSON.parse(text(ownership as CallToolResult)).writeLease).toMatchObject({ status: 'busy', holder: 'other' })
          const overlapping = await replacement.callTool({ name: 'browser_evaluate', arguments: { tabId, script: 'window.__overlap = true' } }) as CallToolResult
          expect(overlapping.isError).toBe(true)
          expect(await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('window.__overlap === true'), fixtureUrl)).toBe(false)
        }
      }
      const held = await electronApp.evaluate(async ({ webContents }, url) => ({ commands: (globalThis as Scope).__rightGate!.commands, popups: (globalThis as Scope).__rightGate!.popups, events: await webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('window.authorityEvents') }), fixtureUrl)
      console.log(JSON.stringify({ probe: 'held', phase, change, held, ownership }))
      await electronApp.evaluate(() => (globalThis as Scope).__rightGate!.release())
      const result = await pending
      await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__rightGate!.commands.filter(value => value.startsWith('mouseReleased')).length)).toBe((phase === 'press' && change !== 'lost-ack') || change === 'unlock' ? 1 : 0)
      await expect.poll(() => electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('window.authorityEvents.filter(event=>event.type==="mouseup").length'), fixtureUrl)).toBe((phase === 'press' && change !== 'lost-ack') || change === 'unlock' ? 1 : 0)
      if (replacement) await expect.poll(async () => (await replacement!.callTool({ name: 'browser_workspaces', arguments: { action: 'claim-ownership', workspaceId: capabilities.workspace.workspaceId } }) as CallToolResult).isError === true).toBe(false)
      const settled = await electronApp.evaluate(async ({ webContents }, url) => ({ commands: (globalThis as Scope).__rightGate!.commands, popups: (globalThis as Scope).__rightGate!.popups, events: await webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('window.authorityEvents') }), fixtureUrl)
      console.log(JSON.stringify({ probe: 'settled', phase, change, settled, result }))
      await info.attach('authority', { body: JSON.stringify({ phase, change, held, ownership, settled, result }), contentType: 'application/json' })
      expect(settled.commands.filter(value => value.startsWith('mousePressed'))).toHaveLength(phase === 'press' || change === 'unlock' ? 1 : 0)
      // This is an observation of a blocking limitation, NOT an accepted product
      // contract: a lost press acknowledgement currently submits no matching up.
      expect(settled.commands.filter(value => value.startsWith('mouseReleased'))).toEqual((phase === 'press' && change !== 'lost-ack') || change === 'unlock' ? ['mouseReleased:right'] : [])
      expect(settled.popups).toBe(0)
      if (phase === 'press' && change === 'lost-ack') {
        expect((result as CallToolResult).structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false, progress: { downAttempted: 1, downAcknowledged: 0, upAttempted: 0 } })
        const blocked = await client.callTool({ name: 'browser_click', arguments: { tabId, selector: '#target', native: true } }) as CallToolResult
        expect(blocked.structuredContent).toMatchObject({ status: 'NOT_DISPATCHED', reason: 'CLICK_STATE_UNCONFIRMED' })
        expect(await electronApp.evaluate(() => (globalThis as Scope).__rightGate!.commands.filter(value => value.startsWith('mousePressed')).length)).toBe(1)
        console.log(JSON.stringify({ probe: 'lost-ack-quarantine', blocked }))
      }
    } finally {
      await replacement?.close().catch(() => undefined)
      transport.send = send
      await electronApp.evaluate(() => { const scope = globalThis as Scope; scope.__rightGate?.release(); scope.__rightGate?.restore(); delete scope.__rightGate; delete scope.__rightClickProbe }).catch(() => undefined)
      if (change === 'pause') await appWindow.evaluate('window.hronautMcp.setPaused(false)').catch(() => undefined)
    }
  })
}

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

const faults = ['lost-down', 'up-preparation', 'lost-up', 'down-relock', 'lost-down-and-relock', 'emergency-up-preparation', 'emergency-lost-up', 'emergency-up-relock', 'persistent-relock', 'hold-up', 'hold-up-relock', 'hold-lost-up', 'hold-failed-relock'] as const
type Probe = { commands: string[]; releasePreparations: number; popups: number; held: boolean; release(): void; restore(): void }
type Scope = typeof globalThis & { __rightClickProbe?: boolean; __cleanupProbe?: Probe }

for (const fault of faults) {
  test(`owned right-click cleanup: ${fault}`, async ({ capabilities, electronApp, appWindow, mcpPort, mcpToken }, info) => {
    const { client, tabId, fixtureUrl, workspace } = capabilities
    await electronApp.evaluate(async ({ webContents, Menu }, { url, fault }) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      await page.executeJavaScript("document.body.innerHTML='<button id=target style=\"position:fixed;left:100px;top:100px;width:180px;height:80px\">Target</button>';window.cleanupEvents=[];for(const type of ['mousedown','mouseup','contextmenu'])document.addEventListener(type,event=>cleanupEvents.push({type,trusted:event.isTrusted,button:event.button}));void 0")
      const send = page.debugger.sendCommand
      const popup = Menu.prototype.popup
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const probe: Probe = { commands: [], releasePreparations: 0, popups: 0, held: false, release, restore: () => { page.debugger.sendCommand = send; Menu.prototype.popup = popup } }
      const scope = globalThis as Scope
      scope.__rightClickProbe = true; scope.__cleanupProbe = probe
      let downExecuted = false
      let upExecuted = false
      let downRelockRejected = false
      Menu.prototype.popup = function (...args) { probe.popups++; const result = popup.apply(this, args); setTimeout(() => this.closePopup(), 100); return result }
      page.debugger.sendCommand = async (method, ...args) => {
        const params = args[0] as Record<string, unknown> | undefined
        if (method === 'Input.setIgnoreInputEvents' && params?.ignore === false && downExecuted) {
          probe.releasePreparations++
          if (fault === 'up-preparation' || fault === 'emergency-up-preparation') throw new Error('Controlled release preparation failure')
        }
        if (method === 'Input.setIgnoreInputEvents' && params?.ignore === true && downExecuted) {
          if (!upExecuted && !downRelockRejected && (fault.includes('relock') || fault.startsWith('emergency-')) && !fault.startsWith('hold-')) {
            downRelockRejected = true
            throw new Error('Controlled press relock failure')
          }
          if (upExecuted && (fault === 'emergency-up-relock' || fault === 'persistent-relock')) throw new Error('Controlled release relock failure')
        }
        if (method === 'Input.dispatchMouseEvent') probe.commands.push(`${params?.type}:${params?.button}`)
        const result = await send.call(page.debugger, method, ...args)
        if (method === 'Input.dispatchMouseEvent' && params?.type === 'mousePressed') {
          downExecuted = true
          if (fault === 'lost-down' || fault === 'lost-down-and-relock' || fault.startsWith('hold-')) throw new Error('Controlled lost press acknowledgement after native execution')
        }
        if (method === 'Input.dispatchMouseEvent' && params?.type === 'mouseReleased') {
          upExecuted = true
          if (fault === 'hold-up' || fault === 'hold-lost-up') { probe.held = true; await barrier }
          if (fault === 'lost-up' || fault === 'emergency-lost-up' || fault === 'hold-lost-up') throw new Error('Controlled lost release acknowledgement after native execution')
        }
        if ((fault === 'hold-up-relock' || fault === 'hold-failed-relock') && upExecuted && method === 'Input.setIgnoreInputEvents' && params?.ignore === true && !probe.held) {
          probe.held = true; await barrier
          if (fault === 'hold-failed-relock') throw new Error('Controlled held relock acknowledgement failure')
        }
        return result
      }
    }, { url: fixtureUrl, fault })
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, true), tabId)
    const transport = client.transport! as StreamableHTTPClientTransport
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
      let ownership: unknown
      let terminalActivity: unknown
      if (fault.startsWith('hold-')) {
        await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__cleanupProbe!.held)).toBe(true)
        await client.notification({ method: 'notifications/cancelled', params: { requestId: requestId!, reason: 'Controlled cleanup cancellation' } })
        abort.abort(); await pending
        await transport.terminateSession()
        replacement = new Client({ name: 'right-cleanup-replacement', version: '1' })
        await replacement.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
        await connectMcpWorkspace(replacement, 'Cleanup reconnect', false, workspace)
        ownership = await replacement.callTool({ name: 'browser_workspaces', arguments: { action: 'ownership-status', workspaceId: workspace.workspaceId } }) as CallToolResult
        expect(JSON.parse(text(ownership as CallToolResult)).writeLease).toMatchObject({ status: 'busy', holder: 'other' })
        const overlap = await replacement.callTool({ name: 'browser_evaluate', arguments: { tabId, script: 'window.__cleanupOverlap = true' } }) as CallToolResult
        expect(overlap.isError).toBe(true)
        expect(await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('window.__cleanupOverlap === true'), fixtureUrl)).toBe(false)
        await expect(appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, false), tabId)).rejects.toThrow('A page is busy')
        await electronApp.evaluate(() => (globalThis as Scope).__cleanupProbe!.release())
        await expect.poll(async () => (await replacement!.callTool({ name: 'browser_workspaces', arguments: { action: 'claim-ownership', workspaceId: workspace.workspaceId } }) as CallToolResult).isError === true).toBe(false)
        await expect.poll(async () => {
          terminalActivity = await electronApp.evaluate(async ({ webContents }, id) => {
            const home = webContents.getAllWebContents().find(page => page.getURL().startsWith('hronaut://home'))!
            const status = await (await home.session.fetch('hronaut://home/api/status')).json() as { recentActivity: Array<{ toolName: string; tabId: string; result?: { outcome?: string } }> }
            return status.recentActivity.find(row => row.toolName === 'browser_click' && row.tabId === id)?.result
          }, tabId)
          return terminalActivity
        }).toMatchObject({ outcome: 'cancelled', effects: 'possible' })
      }
      const result = await pending as CallToolResult | undefined
      const observation = await electronApp.evaluate(async ({ webContents }, url) => {
        const probe = (globalThis as Scope).__cleanupProbe!
        return { commands: probe.commands, releasePreparations: probe.releasePreparations, popups: probe.popups, events: await webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('window.cleanupEvents') }
      }, fixtureUrl)
      console.log(JSON.stringify({ fault, observation, ownership, terminalActivity, result }))
      await info.attach('owned-cleanup', { body: JSON.stringify({ fault, observation, ownership, terminalActivity, result }), contentType: 'application/json' })
      expect(observation.commands.filter(value => value === 'mousePressed:right')).toHaveLength(1)
      expect(observation.releasePreparations).toBe(1)
      const noRawUp = fault === 'up-preparation' || fault === 'emergency-up-preparation'
      expect(observation.commands.filter(value => value === 'mouseReleased:right')).toHaveLength(noRawUp ? 0 : 1)
      expect(observation.events.filter((event: { type: string }) => event.type === 'mouseup')).toHaveLength(noRawUp ? 0 : 1)
      expect(observation.popups).toBe(0)
      expect(await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(tab => tab.id === id)!.humanInteractionLocked, tabId)).toBe(true)
      if (result) {
        expect(result.isError).toBe(true)
        const lostDown = fault === 'lost-down' || fault === 'lost-down-and-relock'
        expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false, progress: { downAttempted: 1, downAcknowledged: lostDown ? 0 : 1, upAttempted: noRawUp ? 0 : 1, upAcknowledged: noRawUp || fault === 'lost-up' || fault === 'emergency-lost-up' ? 0 : 1 } })
      }
    } finally {
      transport.send = send
      await electronApp.evaluate(() => { const scope = globalThis as Scope; scope.__cleanupProbe?.release(); scope.__cleanupProbe?.restore(); delete scope.__cleanupProbe; delete scope.__rightClickProbe }).catch(() => undefined)
      await replacement?.close().catch(() => undefined)
    }
  })
}

for (const unsupported of ['win32', 'darwin']) {
  test(`controlled source platform rejection: ${unsupported}`, async ({ capabilities, electronApp }) => {
    const { client, tabId, fixtureUrl } = capabilities
    // This runs on Linux and changes only the source platform discriminator.
    // It is not native Windows/macOS input or ordering evidence.
    await electronApp.evaluate(({ webContents }, { url, unsupported }) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
      const send = page.debugger.sendCommand
      const scope = globalThis as Scope
      scope.__rightClickProbe = true
      const probe: Probe = { commands: [], releasePreparations: 0, popups: 0, held: false, release: () => {}, restore: () => {
        Object.defineProperty(process, 'platform', platform); page.debugger.sendCommand = send
      } }
      scope.__cleanupProbe = probe
      page.debugger.sendCommand = async (method, ...args) => {
        if (method.startsWith('Input.')) probe.commands.push(method)
        return send.call(page.debugger, method, ...args)
      }
      Object.defineProperty(process, 'platform', { ...platform, value: unsupported })
    }, { url: fixtureUrl, unsupported })
    try {
      const result = await client.callTool({ name: 'browser_click', arguments: { tabId, selector: 'button', native: true } }) as CallToolResult
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('only on Linux')
      const commands = await electronApp.evaluate(() => (globalThis as Scope).__cleanupProbe!.commands)
      expect(commands).toEqual([])
      console.log(JSON.stringify({ controlledPlatform: unsupported, commands, result }))
    } finally {
      await electronApp.evaluate(() => { const scope = globalThis as Scope; scope.__cleanupProbe?.restore(); delete scope.__cleanupProbe; delete scope.__rightClickProbe })
    }
  })
}

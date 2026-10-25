import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserStorageChangesReport, HronautApi, McpTabActivity } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type PublicationGate = { reads: { dom: number; cookies: number }; listenerCount: number; pageId: number; held: boolean; outcome?: { actionId: string; tool: string }; release(): void; restore(): void }
type PublicationGlobal = typeof globalThis & { __comparisonPublicationGate?: PublicationGate }

for (const scenario of ['get', 'baseline', 'compare', 'clear', 'clear empty', 'missing baseline', 'unsupported'] as const) for (const stage of ['audit', 'dom', 'cookies'] as const) for (const change of ['pause', 'pause ABA', 'navigation ABA', 'access ABA', 'control ABA', 'close', 'cancel', 'newer clear', 'newer baseline', 'newer compare', 'audit failure', 'native error', 'unchanged'] as const) {
  const action = scenario === 'clear empty' ? 'clear' : scenario === 'missing baseline' ? 'compare' : scenario === 'unsupported' ? 'get' : scenario
  const validation = scenario === 'missing baseline' || scenario === 'unsupported'
  if ((validation || scenario === 'clear empty') && (stage !== 'audit' || !['pause', 'unchanged'].includes(change))) continue
  if (change === 'native error' && (stage !== 'cookies' || (action !== 'baseline' && action !== 'compare'))) continue
  if (stage !== 'audit' && ['newer baseline', 'newer compare', 'audit failure'].includes(change)) continue
  if (stage !== 'audit' && (action === 'get' || action === 'clear' || ['pause ABA', 'navigation ABA', 'control ABA', 'close'].includes(change))) continue
  test(`Storage comparison ${scenario} publication during ${stage} across ${change}`, async ({ capabilities, electronApp, appWindow }, info) => {
    const { client, tabId, fixtureUrl } = capabilities
    const tool = 'browser_storage_changes'
    await electronApp.evaluate(async ({ webContents }, url) => {
      await webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript("localStorage.setItem('synthetic-comparison-key', 'synthetic-before-canary');true")
    }, fixtureUrl)
    const pageId = await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.id, fixtureUrl)
    const baseline = await client.callTool({ name: tool, arguments: { tabId, action: 'baseline' } }) as CallToolResult
    expect(baseline.isError, text(baseline)).not.toBe(true)
    await electronApp.evaluate(async ({ webContents }, url) => {
      await webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript("localStorage.setItem('synthetic-comparison-key', 'synthetic-after-canary');true")
    }, fixtureUrl)
    const comparison = await client.callTool({ name: tool, arguments: { tabId, action: 'compare', includeValues: true } }) as CallToolResult
    expect(comparison.isError, text(comparison)).not.toBe(true)
    expect(text(comparison)).toContain('synthetic-after-canary')
    await appWindow.evaluate(tool => {
      const scope = window as unknown as { hronaut: HronautApi; comparisonActivities: McpTabActivity[]; stopComparison(): void }
      scope.comparisonActivities = []
      scope.stopComparison = scope.hronaut.onMcpTabActivity(activity => { if (activity.toolName === tool) scope.comparisonActivities.push(activity) })
    }, tool)
    const abort = new AbortController()
    const transport = client.transport!, send = transport.send.bind(transport)
    let cancelled = false
    transport.send = async (message, options) => { await send(message, options); if ('method' in message && message.method === 'notifications/cancelled') cancelled = true }
    const trustedReport = () => appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.storageChanges({ tabId: id, action: 'get', includeValues: true }), tabId)
    let newer: BrowserStorageChangesReport | undefined
    let pending: Promise<CallToolResult> | undefined
    try {
      if (scenario === 'clear empty' || scenario === 'missing baseline') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.storageChanges({ tabId: id, action: 'clear' }), tabId)
      if (scenario === 'unsupported') await electronApp.evaluate(async ({ webContents }, id) => { await webContents.fromId(id)!.loadURL('data:text/html,synthetic-unsupported-canary') }, pageId)
      const started = await client.callTool({ name: 'browser_audit_receipts', arguments: { action: 'start' } }) as CallToolResult
      expect(started.isError, text(started)).not.toBe(true)
      await electronApp.evaluate(async ({ webContents }, { tool, pageId, stage, change, scenario }) => {
        const page = webContents.fromId(pageId)!
        if (scenario !== 'unsupported') await page.executeJavaScript("localStorage.setItem('synthetic-comparison-key', 'synthetic-pending-canary');true")
        const execute = page.executeJavaScript.bind(page), cookies = page.session.cookies, get = cookies.get.bind(cookies)
        const fs = (process.getBuiltinModule('fs') as typeof import('node:fs')).promises
        const { syncBuiltinESMExports } = process.getBuiltinModule('module') as typeof import('node:module')
        const open = fs.open
        let release!: () => void
        const barrier = new Promise<void>(resolve => { release = resolve })
        let actionId = ''
        const gate: PublicationGate = { reads: { dom: 0, cookies: 0 }, listenerCount: page.listenerCount('did-navigate'), pageId: page.id, held: false, release, restore: () => { page.executeJavaScript = execute; cookies.get = get; fs.open = open; syncBuiltinESMExports() } }
        page.executeJavaScript = async (code, userGesture) => {
          const result = await execute(code, userGesture)
          if (code.includes('const fingerprint = (value) =>')) { gate.reads.dom++; if (stage === 'dom') { gate.held = true; await barrier } }
          return result
        }
        cookies.get = async filter => {
          const result = await get(filter)
          // Only the comparison reads one address's cookies; the session cookie saver, a second after a page sets one, reads all.
          if (!filter.url) return result
          gate.reads.cookies++
          if (stage === 'cookies') { gate.held = true; await barrier; if (change === 'native error') throw new Error('synthetic-native-error-canary') }
          return result
        }
        ;(globalThis as PublicationGlobal).__comparisonPublicationGate = gate
        fs.open = async function (...args) {
          const handle = await open.apply(this, args)
          if (String(args[0]).includes('/audit-receipts/') && args[1] === 'a') {
            const write = handle.writeFile.bind(handle)
            handle.writeFile = async (data, options) => {
              const event = JSON.parse(String(data)).event as { phase: string; toolName?: string; actionId?: string }
              if (event.phase === 'decision' && event.toolName === tool) actionId = event.actionId!
              if (stage === 'audit' && event.phase === 'outcome' && event.actionId === actionId && !gate.held) {
                gate.outcome = { actionId: event.actionId!, tool }
                gate.held = true
                await barrier
                if (change === 'audit failure') throw new Error('synthetic-audit-error-canary')
              }
              return write(data, options)
            }
          }
          return handle
        }
        syncBuiltinESMExports()
      }, { tool, pageId, stage, change, scenario })
      pending = (client.callTool({ name: tool, arguments: { tabId, action, includeValues: true } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>).catch(error => { if (change !== 'cancel') throw error; return { isError: true, content: [] } })
      await expect.poll(() => electronApp.evaluate(() => (globalThis as PublicationGlobal).__comparisonPublicationGate?.held)).toBe(true)
      if (change === 'pause' || change === 'pause ABA') {
        const paused = await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, true), tabId)
        expect(paused.tabs.find(tab => tab.id === tabId)?.agentPaused).toBe(true)
        if (change === 'pause ABA') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, false), tabId)
      }
      if (change === 'navigation ABA') await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
        await page.loadURL(url + '?replacement')
        await page.loadURL(url)
      }, fixtureUrl)
      if (change === 'access ABA') await appWindow.evaluate(async id => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        const workspace = (await api.getState()).tabs.find(t => t.id === id)!.mcpGroupId!
        await api.updateTabGroup(workspace, { agentAccess: false })
        await api.updateTabGroup(workspace, { agentAccess: true })
      }, tabId)
      if (change === 'control ABA') await appWindow.evaluate('window.hronautMcp.setPaused(true).then(()=>window.hronautMcp.setPaused(false))')
      if (change === 'close') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), tabId)
      if (change === 'cancel') { abort.abort(); await expect.poll(() => cancelled).toBe(true) }
      if (change === 'newer baseline' || change === 'newer compare') {
        await electronApp.evaluate(() => (globalThis as PublicationGlobal).__comparisonPublicationGate!.restore())
        newer = await appWindow.evaluate(async ({ id, change }) => {
          const api = (window as unknown as { hronaut: HronautApi }).hronaut
          const baseline = await api.storageChanges({ tabId: id, action: 'baseline', includeValues: true })
          return change === 'newer baseline' ? baseline : api.storageChanges({ tabId: id, action: 'compare', includeValues: true })
        }, { id: tabId, change })
      }
      if (change === 'newer clear') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.storageChanges({ tabId: id, action: 'clear' }), tabId)
      const gate = await electronApp.evaluate(() => (globalThis as PublicationGlobal).__comparisonPublicationGate!.outcome)
      if (stage === 'audit') { expect(gate?.tool).toBe(tool); expect(gate?.actionId).toBeTruthy() }
      await electronApp.evaluate(() => (globalThis as PublicationGlobal).__comparisonPublicationGate!.release())
      const result = await pending
      await expect.poll(() => appWindow.evaluate(() => (window as unknown as { comparisonActivities: McpTabActivity[] }).comparisonActivities.filter(a => a.phase !== 'started').length)).toBe(1)
      const activity = await appWindow.evaluate(() => (window as unknown as { comparisonActivities: McpTabActivity[] }).comparisonActivities)
      const observed = await electronApp.evaluate(({ webContents }) => {
        const probe = (globalThis as PublicationGlobal).__comparisonPublicationGate!
        const page = webContents.fromId(probe.pageId)
        return { reads: probe.reads, listenerDelta: page && !page.isDestroyed() ? page.listenerCount('did-navigate') - probe.listenerCount : 0 }
      })
      const retained = change === 'close' || scenario === 'unsupported' ? undefined : await trustedReport()
      await info.attach('comparison-publication', { body: JSON.stringify({ action, stage, change, gate, completedComparison: JSON.parse(text(comparison)), result, activity, observed, retained }), contentType: 'application/json' })
      expect(observed.listenerDelta).toBe(0)
      expect(observed.reads.dom).toBe(!validation && (action === 'baseline' || action === 'compare') ? 1 : 0)
      expect(observed.reads.cookies).toBe(!validation && (action === 'baseline' || action === 'compare') ? (stage === 'dom' && change !== 'unchanged' ? 0 : 1) : 0)
      if (change === 'unchanged' && validation) {
        expect(result.isError).toBe(true)
        expect(result.structuredContent).toMatchObject({ status: 'REJECTED', reason: scenario === 'unsupported' ? 'UNSUPPORTED_SCHEME' : 'BASELINE_REQUIRED', comparisonStateChanged: false, effects: 'none' })
        expect(text(result)).toContain(scenario === 'unsupported' ? 'HTTP and HTTPS' : 'Set a storage baseline')
      } else if (change === 'unchanged') {
        expect(result.isError, text(result)).not.toBe(true)
        const report = JSON.parse(text(result)) as BrowserStorageChangesReport
        expect(report.status).toBe(action === 'baseline' ? 'baseline' : action === 'clear' ? 'empty' : 'compared')
        if (action === 'get' || action === 'compare') expect(text(result)).toContain(action === 'get' ? 'synthetic-after-canary' : 'synthetic-pending-canary')
        expect(activity.filter(a => a.phase !== 'started')[0]).toMatchObject({ phase: 'finished', result: { outcome: 'succeeded' } })
      } else {
        const changed = stage === 'audit' && action !== 'get' && !validation && scenario !== 'clear empty'
        if (change !== 'cancel') {
          expect(result.isError, text(result)).toBe(true)
          expect(result.structuredContent).toMatchObject({ comparisonStateChanged: changed, siteStorageWriteSubmitted: false, effects: changed ? 'possible' : 'none', retrySafe: false })
          for (const canary of ['synthetic-before-canary', 'synthetic-after-canary', 'synthetic-pending-canary', 'synthetic-comparison-key', 'synthetic-unsupported-canary', 'synthetic-native-error-canary', 'synthetic-audit-error-canary', 'BASELINE_REQUIRED', 'UNSUPPORTED_SCHEME']) expect(JSON.stringify(result)).not.toContain(canary)
        }
        expect(activity.filter(a => a.phase !== 'started')[0]).toMatchObject({ phase: 'failed', result: { effects: changed ? 'possible' : 'none', ...(change === 'cancel' ? { outcome: 'cancelled', reasonCode: 'REQUEST_CANCELLED' } : {}) } })
        if (retained) {
          if (newer) { expect(retained).toMatchObject({ baselineAt: newer.baselineAt, status: newer.status, changes: newer.changes }); expect(retained.comparedAt).toBe(newer.comparedAt) }
          else if (validation || scenario === 'clear empty') expect(retained.status).toBe('empty')
          else if (change === 'newer clear' || (changed && action === 'clear')) expect(retained.status).toBe('empty')
          else if (!changed) expect(retained).toMatchObject({ baselineAt: JSON.parse(text(comparison)).baselineAt, comparedAt: JSON.parse(text(comparison)).comparedAt, changes: JSON.parse(text(comparison)).changes })
          else if (action === 'baseline') expect(retained.status).toBe('baseline')
          else if (action === 'compare') expect(JSON.stringify(retained.changes)).toContain('synthetic-pending-canary')
        }
      }
    } finally {
      transport.send = send
      await electronApp.evaluate(() => {
        const scope = globalThis as PublicationGlobal
        scope.__comparisonPublicationGate?.release()
        scope.__comparisonPublicationGate?.restore()
        delete scope.__comparisonPublicationGate
      }).catch(() => undefined)
      await pending?.catch(() => undefined)
      await appWindow.evaluate(() => (window as unknown as { stopComparison(): void }).stopComparison()).catch(() => undefined)
    }
  })
}

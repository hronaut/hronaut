import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

for (const tool of ['browser_cpu_profile', 'browser_code_coverage'] as const) {
  for (const action of ['start', 'stop', 'clear'] as const) {
    test(`does not restore ${tool} after debugger detachment while ${action === 'start' ? 'starting' : action === 'stop' ? 'stopping' : 'clearing'}`, async ({ capabilities, electronApp, appWindow }) => {
      const { client, tabId, fixtureUrl } = capabilities
      if (action !== 'start') {
        const started = await client.callTool({
          name: tool, arguments: { tabId, action: 'start', ...(tool === 'browser_code_coverage' ? { reload: false } : {}) }
        }) as CallToolResult
        expect(started.isError, text(started)).not.toBe(true)
      }
      let stopping: Promise<CallToolResult> | undefined
      let restarting: Promise<{ status: string }> | undefined
      await electronApp.evaluate(({ webContents }, { url, command }) => {
        const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
        if (!page) throw new Error('Profiler fixture page was not found')
        const original = page.debugger.sendCommand
        let release!: () => void
        const pending = new Promise<void>(resolve => { release = resolve })
        const gate = { held: false, release, restore: () => { page.debugger.sendCommand = original } }
        ;(globalThis as typeof globalThis & { __hronautProfilerStopGate?: typeof gate }).__hronautProfilerStopGate = gate
        page.debugger.sendCommand = async function (...args) {
          const result = await original.apply(this, args)
          if (!gate.held && args[0] === command) {
            gate.held = true
            await pending
          }
          return result
        }
      }, { url: fixtureUrl, command: action !== 'start' ? 'Profiler.disable' : tool === 'browser_cpu_profile' ? 'Profiler.start' : 'CSS.startRuleUsageTracking' })
      try {
        stopping = client.callTool({ name: tool, arguments: { tabId, action, ...(tool === 'browser_code_coverage' ? { reload: false } : {}) } }) as Promise<CallToolResult>
        await expect.poll(() => electronApp.evaluate(() => (
          (globalThis as typeof globalThis & { __hronautProfilerStopGate?: { held: boolean } })
            .__hronautProfilerStopGate?.held
        ))).toBe(true)
        await electronApp.evaluate(({ webContents }, url) => {
          const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
          if (!page) throw new Error('Profiler fixture page was not found')
          page.debugger.detach()
        }, fixtureUrl)
        if (action === 'clear') {
          // MCP keeps the tab busy; the human shell remains an independent supported entrypoint.
          const busy = await client.callTool({ name: tool, arguments: { tabId, action: 'get' } }) as CallToolResult
          expect(JSON.parse(text(busy))).toMatchObject({ status: 'BUSY' })
          const method = tool === 'browser_cpu_profile' ? 'manageCpuProfile' : 'manageCodeCoverage'
          restarting = appWindow.evaluate(`window.hronaut.${method}(${JSON.stringify({ tabId, action: 'start', reload: false })})`)
          await expect.poll(() => appWindow.evaluate(
            `window.hronaut.${method}(${JSON.stringify({ tabId, action: 'get' })}).then(result => result.status)`
          )).toBe('recording')
        }
        await electronApp.evaluate(() => {
          ;(globalThis as typeof globalThis & { __hronautProfilerStopGate?: { release: () => void } })
            .__hronautProfilerStopGate?.release()
        })
        const stopped = await stopping
        expect(stopped.isError).toBe(true)
        expect(text(stopped)).toContain(`changed while ${action === 'start' ? 'starting' : action === 'stop' ? 'stopping' : 'clearing'}`)
        if (restarting) {
          const restarted = await restarting
          expect(restarted).toMatchObject({ status: 'recording' })
        }
        const current = await client.callTool({ name: tool, arguments: { tabId, action: 'get' } }) as CallToolResult
        expect(current.isError, text(current)).not.toBe(true)
        expect(JSON.parse(text(current))).toMatchObject({ status: action === 'clear' ? 'recording' : 'idle' })
        if (action === 'clear') {
          const report = await client.callTool({ name: tool, arguments: { tabId, action: 'stop' } }) as CallToolResult
          expect(report.isError, text(report)).not.toBe(true)
          expect(JSON.parse(text(report))).toMatchObject({ status: 'complete', report: expect.any(Object) })
        }
      } finally {
        await electronApp.evaluate(() => {
          const gate = (globalThis as typeof globalThis & {
            __hronautProfilerStopGate?: { release: () => void; restore: () => void }
          }).__hronautProfilerStopGate
          gate?.release()
          gate?.restore()
          delete (globalThis as typeof globalThis & { __hronautProfilerStopGate?: unknown }).__hronautProfilerStopGate
        }).catch(() => undefined)
        await stopping?.catch(() => undefined)
        await restarting?.catch(() => undefined)
      }
    })
  }
}

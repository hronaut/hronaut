import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

for (const tool of ['browser_cpu_profile', 'browser_code_coverage'] as const) {
  for (const action of ['start', 'stop'] as const) {
    test(`does not restore ${tool} after debugger detachment while ${action === 'start' ? 'starting' : 'stopping'}`, async ({ capabilities, electronApp }) => {
      const { client, tabId, fixtureUrl } = capabilities
      if (action === 'stop') {
        const started = await client.callTool({
          name: tool, arguments: { tabId, action: 'start', ...(tool === 'browser_code_coverage' ? { reload: false } : {}) }
        }) as CallToolResult
        expect(started.isError, text(started)).not.toBe(true)
      }
      let stopping: Promise<CallToolResult> | undefined
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
      }, { url: fixtureUrl, command: action === 'stop' ? 'Profiler.disable' : tool === 'browser_cpu_profile' ? 'Profiler.start' : 'CSS.startRuleUsageTracking' })
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
          ;(globalThis as typeof globalThis & { __hronautProfilerStopGate?: { release: () => void } })
            .__hronautProfilerStopGate?.release()
        }, fixtureUrl)
        const stopped = await stopping
        expect(stopped.isError).toBe(true)
        expect(text(stopped)).toContain(`changed while ${action === 'start' ? 'starting' : 'stopping'}`)
        const current = await client.callTool({ name: tool, arguments: { tabId, action: 'get' } }) as CallToolResult
        expect(current.isError, text(current)).not.toBe(true)
        expect(JSON.parse(text(current))).toMatchObject({ status: 'idle' })
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
      }
    })
  }
}

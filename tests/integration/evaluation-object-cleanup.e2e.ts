import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

type EvaluationProbe = {
  objectIds: Set<string>
  inspect: (objectId: string) => Promise<unknown>
  release: (objectId: string) => Promise<unknown>
  restore: () => void
}

test('releases debugger exception handles after failed MCP evaluations', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  await electronApp.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
    if (!page) throw new Error('Evaluation fixture missing')
    const original = page.debugger.sendCommand.bind(page.debugger)
    const probe: EvaluationProbe = {
      objectIds: new Set(),
      inspect: objectId => original('Runtime.getProperties', { objectId }),
      release: objectId => original('Runtime.releaseObject', { objectId }),
      restore: () => { Object.defineProperty(page.debugger, 'sendCommand', { configurable: true, value: original }) }
    }
    ;(globalThis as unknown as { qaEvaluationProbe: EvaluationProbe }).qaEvaluationProbe = probe
    Object.defineProperty(page.debugger, 'sendCommand', {
      configurable: true,
      value: async (method: string, params?: Record<string, unknown>, sessionId?: string) => {
        const response = await original(method, params, sessionId)
        if (method === 'Runtime.evaluate' && String(params?.expression).includes('evaluation-cleanup-marker')) {
          const details = response as {
            result?: { objectId?: string }
            exceptionDetails?: { exception?: { objectId?: string } }
          }
          for (const objectId of [details.result?.objectId, details.exceptionDetails?.exception?.objectId]) {
            if (objectId) probe.objectIds.add(objectId)
          }
        }
        return response
      }
    })
  }, fixtureUrl)

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await client.callTool({
        name: 'browser_evaluate',
        arguments: { tabId, script: 'throw new Error("evaluation-cleanup-marker")', dialogAction: 'dismiss' }
      }) as CallToolResult
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('evaluation-cleanup-marker')
    }
    const handles = await electronApp.evaluate(async () => {
      const probe = (globalThis as unknown as { qaEvaluationProbe: EvaluationProbe }).qaEvaluationProbe
      let retained = 0
      for (const objectId of probe.objectIds) {
        try {
          await probe.inspect(objectId)
          retained += 1
        } catch (error) {
          if (!String(error).includes('Could not find object')) throw error
        }
      }
      return { total: probe.objectIds.size, retained }
    })
    expect(handles.total).toBeGreaterThanOrEqual(3)
    expect(handles.retained).toBe(0)
  } finally {
    await electronApp.evaluate(async () => {
      const holder = globalThis as unknown as { qaEvaluationProbe?: EvaluationProbe }
      const probe = holder.qaEvaluationProbe
      if (!probe) return
      probe.restore()
      await Promise.allSettled([...probe.objectIds].map(objectId => probe.release(objectId)))
      delete holder.qaEvaluationProbe
    })
  }
})

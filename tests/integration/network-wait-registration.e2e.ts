import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { test, expect, text } from './capability-fixtures.js'
import { installNetworkWaitProbe, dispatchNetworkWaitProbe, readNetworkWaitProbe, restoreNetworkWaitProbe } from './network-wait-fixture.js'

// Controlled ordering characterizes from:future; it does not reconstruct the
// original uninstrumented CI timeout or alter production registration/deadlines.
for (const phase of ['before-entry', 'after-registration'] as const) {
  test(`future network wait registration ${phase}`, async ({ capabilities, electronApp }, info) => {
    const { client, tabId, fixtureUrl, address } = capabilities
    const sequence = 'registration-control'
    const network = async () => {
      const result = await client.callTool({ name: 'browser_network', arguments: { tabId } }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      return JSON.parse(text(result)) as Array<{ url: string; completedAt?: string }>
    }
    await network()
    let pending: Promise<CallToolResult> | undefined
    try {
      await installNetworkWaitProbe(electronApp, fixtureUrl, sequence)
      if (phase === 'before-entry') {
        await dispatchNetworkWaitProbe(electronApp, fixtureUrl, sequence)
        await expect.poll(async () => (await network()).some(r => new URL(r.url).searchParams.get('sequence') === sequence && Boolean(r.completedAt))).toBe(true)
      }
      pending = client.callTool({ name: 'browser_network_wait', arguments: {
        tabId, urlPattern: `*://127.0.0.1:${address.port}/wait-probe*`, method: 'GET', resourceType: 'fetch/xhr', status: 202, phase: 'complete', from: 'future', timeoutMs: 5_000
      } }) as Promise<CallToolResult>
      await expect.poll(async () => (await readNetworkWaitProbe(electronApp)).registered).toBe(true)
      if (phase === 'after-registration') await dispatchNetworkWaitProbe(electronApp, fixtureUrl, sequence)
      const result = await pending
      const registration = await readNetworkWaitProbe(electronApp)
      await info.attach('network-wait-registration', { body: JSON.stringify({ phase, result, registration }), contentType: 'application/json' })
      expect(result.isError === true).toBe(phase === 'before-entry')
      if (phase === 'before-entry') {
        expect(text(result)).toContain('Timed out after 5000 ms waiting for a matching network complete.')
        expect(registration.events).toEqual(['fetch-dispatched', 'request-captured', 'wait-timer-created', 'registration-stack-complete'])
      } else {
        const matched = JSON.parse(text(result))
        expect(matched).toMatchObject({ matchedFrom: 'future', request: { status: 202, completedAt: expect.any(String) } })
        expect(new URL(matched.request.url).searchParams.get('sequence')).toBe(sequence)
        expect(text(result)).not.toContain('network-wait-secret')
        expect(registration.events).toEqual(['wait-timer-created', 'registration-stack-complete', 'fetch-dispatched', 'request-captured'])
      }
    } finally {
      await restoreNetworkWaitProbe(electronApp)
      await pending?.catch(() => undefined)
    }
  })
}

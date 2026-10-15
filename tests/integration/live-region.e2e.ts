import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

interface LiveRegionReport {
  active: boolean
  stopReason?: string
  metadata?: Record<string, unknown>
  initial?: { text: string; empty: boolean; truncated: boolean }
  observations: Array<{ text: string; empty: boolean; truncated: boolean; mutationRecords: number; ariaBusy?: boolean }>
  callbackCount: number
  unchangedCallbacks: number
  limits: Record<string, number>
  caveats: string[]
}

test('records transient text of one selected live region without unrelated or form text', async ({ capabilities, appWindow }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const call = async (name: string, args: Record<string, unknown>) => (
    await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
  )
  const evaluate = async (script: string) => {
    const result = await call('browser_evaluate', { script })
    expect(result.isError, text(result)).not.toBe(true)
    return text(result)
  }
  const liveRegion = async (args: Record<string, unknown>) => {
    const result = await call('browser_live_region', args)
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)) as LiveRegionReport
  }

  await evaluate(`(() => {
    const status = document.createElement('div');
    status.id = 'live-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-busy', 'false');
    status.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)';
    status.innerHTML = 'Ready<input id="live-field" value="live-canary-value"><span contenteditable="true">live-canary-editable</span>';
    const other = document.createElement('p');
    other.id = 'live-other';
    other.textContent = 'live-canary-other';
    document.body.append(status, other);
    return true;
  })()`)

  const started = await liveRegion({ action: 'start', selector: '#live-status' })
  expect(started).toMatchObject({
    active: true,
    metadata: { role: 'status', ariaLive: 'polite', ariaBusy: false },
    initial: { text: 'Ready', empty: false, truncated: false },
    observations: [],
    limits: { maxObservations: 100, maxObservationChars: 1000, maxTotalChars: 50000, maxNodesPerRead: 2000, maxCallbacks: 10000, maxDurationMs: 300000 }
  })
  expect(started.caveats.join(' ')).toContain('private information')
  expect(await evaluate(`typeof window.__hronautLiveRegionV1`)).toBe('undefined')

  // Each evaluate call is its own task, so each update reaches a separate observer callback.
  await evaluate(`(() => { const s = document.querySelector('#live-status'); s.setAttribute('aria-busy', 'true'); s.firstChild.data = 'Loading results'; return true })()`)
  await evaluate(`(() => { document.querySelector('#live-other').textContent = 'live-canary-other-update'; document.querySelector('#live-field').value = 'live-canary-typed'; return true })()`)
  await evaluate(`(() => { const s = document.querySelector('#live-status'); s.firstChild.data = 'Step 1'; s.firstChild.data = 'Step 2'; s.firstChild.data = '12 results'; s.setAttribute('aria-busy', 'false'); return true })()`)
  await evaluate(`(() => { document.querySelector('#live-status').replaceChildren(); return true })()`)
  expect(await evaluate(`JSON.stringify(document.querySelector('#live-status').textContent)`)).toBe('""')

  const recorded = await liveRegion({ action: 'get' })
  expect(recorded.observations.map(entry => [entry.text, entry.empty, entry.ariaBusy])).toEqual([
    ['Loading results', false, true],
    ['12 results', false, false],
    ['', true, false]
  ])
  expect(recorded.observations[1]?.mutationRecords).toBe(3)
  const recordedText = JSON.stringify(recorded)
  for (const canary of ['live-canary-value', 'live-canary-editable', 'live-canary-other', 'live-canary-typed', 'Step 1', 'Step 2']) {
    expect(recordedText).not.toContain(canary)
  }

  const stopped = await liveRegion({ action: 'stop' })
  expect(stopped).toMatchObject({ active: false, stopReason: 'stopped' })
  await evaluate(`(() => { document.querySelector('#live-status').textContent = 'after stop'; return true })()`)
  expect((await liveRegion({ action: 'get' })).observations).toHaveLength(3)

  for (const [selector, message] of [
    ['p, #live-status', 'matches more than one element'],
    ['#name', 'cannot be recorded'],
    ['body', 'not the html, head or body element'],
    ['#missing-region', 'No element matches']
  ]) {
    const rejected = await call('browser_live_region', { action: 'start', selector })
    expect(rejected.isError, selector).toBe(true)
    expect(text(rejected)).toContain(message)
  }
  expect(await liveRegion({ action: 'get' })).toMatchObject({ active: false, observations: [] })

  await liveRegion({ action: 'start', selector: '#live-status' })
  await evaluate(`(() => { document.querySelector('#live-status').remove(); const replacement = document.createElement('div'); replacement.id = 'live-status'; document.body.append(replacement); replacement.textContent = 'live-canary-replacement'; return true })()`)
  const detached = await liveRegion({ action: 'get' })
  expect(detached).toMatchObject({ active: false, stopReason: 'detached', observations: [] })
  expect(JSON.stringify(detached)).not.toContain('live-canary-replacement')

  // A person taking over the tab releases the recorded text before the agent can read it again.
  await liveRegion({ action: 'start', selector: '#live-status' })
  await evaluate(`(() => { document.querySelector('#live-status').textContent = 'live-canary-before-pause'; return true })()`)
  expect((await liveRegion({ action: 'get' })).observations).toHaveLength(1)
  const setPaused = (paused: boolean) => appWindow.evaluate(([id, value]) => (
    (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, value)
  ), [tabId, paused] as const)
  await setPaused(true)
  await setPaused(false)
  const released = await liveRegion({ action: 'get' })
  expect(released).toMatchObject({ active: false, observations: [], callbackCount: 0 })
  expect(JSON.stringify(released)).not.toContain('live-canary-before-pause')

  await liveRegion({ action: 'start', selector: '#live-status' })
  const navigated = await call('browser_navigate', { url: fixtureUrl })
  expect(navigated.isError, text(navigated)).not.toBe(true)
  expect(await liveRegion({ action: 'get' })).toMatchObject({ active: false, observations: [], callbackCount: 0 })
  expect(await liveRegion({ action: 'clear' })).toMatchObject({ active: false, observations: [] })
})

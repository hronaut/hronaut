import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { collectPartial, fixtureObserver, safeDiagnostic } from './integration/oopif-diagnostic.js'

describe('diagnostic-only OOPIF export', () => {
  it('reconstructs an allowlist and removes page bodies, URLs, paths, payloads and arbitrary strings', () => {
    const secret = 'private-page-profile-token'
    const report = safeDiagnostic({ arm: secret, assertion: secret, result: secret, rootEvents: [{ kind: secret, role: secret, target: secret, text: secret, x: secret }], framesBefore: [{ url: secret, processId: 9, routingId: 2 }] })
    expect(report).not.toContain(secret)
    expect(JSON.parse(report).framesBefore).toEqual([{ role: 'unknown', processId: 9, routingId: 2 }])
  })
  it('caps arrays, rejects nonfinite numbers and retains the failed immediate observation', () => {
    const event = { kind: 'click', role: 'child', target: 'button', x: Infinity, at: 123 }
    const report = JSON.parse(safeDiagnostic({ assertion: 'failed', immediateHits: 0, settledHits: 1, childHits: 1, rootEvents: Array(2000).fill(event), commands: Array(2000).fill(event) }))
    expect(report.rootEvents).toHaveLength(32)
    expect(report.commands).toHaveLength(12)
    expect(report.rootEvents[0].x).toBeNull()
    expect(report).toMatchObject({ assertion: 'failed', immediateHits: 0, settledHits: 1, childHits: 1 })
    expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThan(65536)
  })
  it('does not coerce malicious objects into allowed enum values', () => {
    const report = safeDiagnostic({ rootEvents: [{ kind: { toString: () => 'click', secret: 'private-token' }, target: { toString: () => 'button', secret: 'private-token' } }] })
    expect(report).not.toContain('private-token')
  })
  it('emits a fixed role and bounded observer without storing message payloads', () => {
    const script = fixtureObserver('child')
    expect(script).toContain("role:'child'")
    expect(script).toContain('state.events.length<32')
    expect(script).not.toContain('innerHTML')
  })
})


describe('diagnostic review regressions', () => {
  it('preserves root and native records when child collection rejects', async () => {
    const result = await collectPartial({ native: async () => ({ commands: [{ kind: 'mousePressed' }] }), root: async () => ({ settledHits: 0 }), child: async () => { throw new Error('private error') } })
    expect(result.data).toEqual({ commands: [{ kind: 'mousePressed' }], settledHits: 0 })
    expect(result.availability).toEqual({ native: 'fulfilled', root: 'fulfilled', child: 'rejected' })
    expect(safeDiagnostic({ ...result.data, availability: result.availability })).not.toContain('private error')
  })
  it.each(['native', 'root', 'child', 'frames'])('isolates a rejected %s reader from the other records', async failed => {
    const readers = Object.fromEntries(['native', 'root', 'child', 'frames'].map(key => [key, async () => {
      if (key === failed) throw new Error('private failure')
      return { [key]: 1 }
    }]))
    const result = await collectPartial(readers)
    expect(result.availability[failed]).toBe('rejected')
    expect(Object.keys(result.data)).toHaveLength(3)
    for (const key of Object.keys(readers).filter(key => key !== failed)) {
      expect(result.data[key]).toBe(1)
      expect(result.availability[key]).toBe('fulfilled')
    }
  })
  it('preserves settled records on timeout and ignores late completion', async () => {
    vi.useFakeTimers()
    try {
      let finish!: (value: Record<string, unknown>) => void
      const pending = collectPartial({ native: async () => ({ nativeEvents: [] }), root: async () => ({ settledHits: 1 }), child: () => new Promise(resolve => { finish = resolve }) })
      await vi.advanceTimersByTimeAsync(1500)
      const result = await pending
      expect(result.data).toEqual({ nativeEvents: [], settledHits: 1 })
      expect(result.availability.child).toBe('timeout')
      finish({ childHits: 9 })
      await Promise.resolve()
      expect(result.data).not.toHaveProperty('childHits')
    } finally { vi.useRealTimers() }
  })
  it('counts observer drops and errors without leaking event data', () => {
    const callbacks: Record<string, (event: unknown) => void> = {}
    const window: Record<string, unknown> = {}
    runInNewContext(fixtureObserver('child').replace(/^<script>|<\/script>$/g, ''), { window, document: { addEventListener: () => undefined }, addEventListener: (kind: string, listener: (event: unknown) => void) => { callbacks[kind] = listener } })
    const state = window.__oopif as { events: unknown[]; dropped: number; errors: number }
    callbacks.click!({ get target() { throw new Error('secret') } })
    expect(state.errors).toBe(1)
    for (let index = 0; index < 40; index++) callbacks.click!({})
    expect(state.events).toHaveLength(32)
    expect(state.dropped).toBe(9)
    state.dropped = 1000000
    callbacks.click!({})
    expect(state.dropped).toBe(1000000)
    const exported = JSON.parse(safeDiagnostic({ childEvents: state.events, childDropped: state.dropped, childErrors: state.errors }))
    expect(exported).toMatchObject({ truncated: true, counters: { childDropped: 1000000, childErrors: 1 } })
    expect(JSON.stringify(exported)).not.toContain('secret')
  })
  it('marks partial observer installation unavailable and counts its error', () => {
    const window: Record<string, unknown> = {}
    runInNewContext(fixtureObserver('root').replace(/^<script>|<\/script>$/g, ''), { window, addEventListener: () => { throw new Error('private failure') } })
    expect(window.__oopif).toMatchObject({ available: false, errors: 1 })
    const result = JSON.parse(safeDiagnostic({ rootObserverAvailable: false, rootErrors: 1 }))
    expect(result).toMatchObject({ rootObserverAvailable: false, counters: { rootErrors: 1 } })
  })
  it('reports exporter truncation separately from observer drops', () => {
    const result = JSON.parse(safeDiagnostic({ commands: Array(20).fill({}), rootDropped: 3, rootErrors: -2 }))
    expect(result).toMatchObject({ truncated: true, exportDropped: { commands: 8 }, counters: { rootDropped: 3, rootErrors: null } })
  })
  it('executes the actual SHA guard before checkout and rejects mismatches and malformed inputs', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    const guard = workflow.split('\n').find(line => line.includes('[[ "$EXPECTED_SHA"'))!.trim()
    expect(workflow.indexOf(guard)).toBeLessThan(workflow.indexOf('uses: actions/checkout'))
    expect(workflow).toContain('ref: ${{ github.sha }}')
    expect(workflow).not.toContain('ref: ${{ inputs.expected_sha }}')
    const sha = 'a'.repeat(40)
    for (const [expected, status] of [[sha, 0], ['b'.repeat(40), 1], ['', 1], ['$(exit 0)', 1], ['A'.repeat(40), 1]] as const) {
      expect(spawnSync('bash', ['-c', guard], { env: { EXPECTED_SHA: expected, GITHUB_SHA: sha } }).status).toBe(status)
    }
  })
})

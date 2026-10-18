import { describe, expect, it, vi } from 'vitest'
import { RendererExitedError } from '../src/main/browser/renderer-exit-guard.js'
import { acquireNativeClickAdmission, nativeClickProgress, nativeClickObserver, nativeClickReason, nativeClickEffectsPossible, NativeClickAdmissionError } from '../src/main/browser/native-click-admission.js'

function fixture(options: { reason?: string; node?: object; cleanupFails?: boolean; acquisitionFails?: boolean; rendererExited?: boolean } = {}) {
  const calls: Array<[string, Record<string, unknown> | undefined]> = []
  const api = { sendCommand: vi.fn(async (method: string, params?: Record<string, unknown>) => {
    calls.push([method, params])
    if (options.rendererExited) throw new RendererExitedError(false)
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'top' } } }
    if (method === 'Page.createIsolatedWorld') return { executionContextId: 9 }
    if (method === 'Runtime.evaluate') return options.acquisitionFails ? { exceptionDetails: { text: 'private value' } } : { result: { objectId: 'guard' } }
    if (method === 'Runtime.callFunctionOn') return String(params?.functionDeclaration).includes('this.receiver')
      ? { result: { objectId: 'receiver' } } : { result: { value: options.reason ?? 'ADMITTED' } }
    if (method === 'DOM.describeNode') return { node: options.node ?? { nodeName: 'SPAN', localName: 'span' } }
    if (method === 'Runtime.releaseObjectGroup' && options.cleanupFails) throw new Error('cleanup transport')
    return {}
  }) }
  return { api, calls, progress: nativeClickProgress() }
}
describe('operation-owned native click admission', () => {
  it('whitelists reasons and classifies main-owned preparation independently from presses', () => {
    expect(nativeClickReason('private page value')).toBe('CONTEXT_OR_INPUT_UNCERTAIN')
    expect(nativeClickReason({ reason: 'private page value' })).toBe('CONTEXT_OR_INPUT_UNCERTAIN')
    expect(nativeClickReason('TARGET_OCCLUDED')).toBe('TARGET_OCCLUDED')
    const progress = nativeClickProgress()
    expect(nativeClickEffectsPossible(progress)).toBe(false)
    progress.preparationAttempted = true
    expect(nativeClickEffectsPossible(progress)).toBe(true)
  })
  it('preserves fractional coordinates and samples again after native receiver metadata', async () => {
    const f = fixture(); const guard = await acquireNativeClickAdmission(f.api, { selector: '#one' }, () => {}, f.progress, () => {})
    await guard.sample(1.125, 20.875); await guard.dispose(); await guard.dispose()
    const samples = f.calls.filter(([name, p]) => name === 'Runtime.callFunctionOn' && String(p?.functionDeclaration).includes('this.sample'))
    expect(samples.map(([, p]) => p?.arguments)).toEqual([[{ value: 1.125 }, { value: 20.875 }, { value: false }], [{ value: 1.125 }, { value: 20.875 }, { value: true }]])
    expect(f.calls.filter(([m]) => m === 'Runtime.releaseObjectGroup')).toHaveLength(1)
    expect(f.progress.targetCleanup).toBe('confirmed')
  })
  for (const node of [{ nodeName: 'IFRAME', localName: 'iframe' }, { nodeName: 'DIV', localName: 'div', shadowRoots: [{ shadowRootType: 'closed' }] }, { nodeName: 'INPUT', localName: 'input', shadowRoots: [{ shadowRootType: 'user-agent' }] }, { nodeName: 'OBJECT', localName: 'object', contentDocument: {} }]) {
    it(`rejects ambiguous native descriptor ${JSON.stringify(node)}`, async () => {
      const f = fixture({ node }); const guard = await acquireNativeClickAdmission(f.api, { ref: 'e1' }, () => {}, f.progress, () => {})
      await expect(guard.sample(1, 2)).rejects.toMatchObject({ reason: 'EMBEDDED_HIT_UNSUPPORTED' }); await guard.dispose()
      expect(f.calls.filter(([m, p]) => m === 'Runtime.callFunctionOn' && String(p?.functionDeclaration).includes('this.sample'))).toHaveLength(1)
    })
  }
  it('fails closed and releases exception object group without exposing page exception content', async () => {
    const f = fixture({ acquisitionFails: true })
    await expect(acquireNativeClickAdmission(f.api, { selector: '#one' }, () => {}, f.progress, () => {})).rejects.toMatchObject({ reason: 'TARGET_UNAVAILABLE' })
    expect(f.progress.targetCleanup).toBe('confirmed')
  })
  for (const node of [
    { nodeName: 'iframe', localName: 'iframe' },
    { nodeName: 'h:object', localName: 'object' },
    { nodeName: 'h:embed' },
    { nodeName: 'frame', localName: 'frame' }
  ]) {
    it(`rejects inactive embedded local names without a child document: ${node.nodeName}`, async () => {
      const f = fixture({ node: { ...node, attributes: ['data-private', 'descriptor-canary'] } })
      const guard = await acquireNativeClickAdmission(f.api, { selector: '#one' }, () => {}, f.progress, () => {})
      const error = await guard.sample(1, 2).catch(error => error)
      expect(error).toMatchObject({ reason: 'EMBEDDED_HIT_UNSUPPORTED' })
      expect(JSON.stringify(error)).not.toContain('descriptor-canary')
      await guard.dispose()
      expect(f.progress.targetCleanup).toBe('confirmed')
    })
  }
  it('keeps cleanup uncertainty visible and never retries cleanup implicitly', async () => {
    const f = fixture({ cleanupFails: true }); const guard = await acquireNativeClickAdmission(f.api, { selector: '#one' }, () => {}, f.progress, () => {})
    await expect(guard.dispose()).rejects.toBeInstanceOf(NativeClickAdmissionError); await guard.dispose()
    expect(f.progress.targetCleanup).toBe('unconfirmed'); expect(f.calls.filter(([m]) => m === 'Runtime.releaseObjectGroup')).toHaveLength(1)
  })
  it('confirms cleanup when the page renderer has exited, since its objects exited with it', async () => {
    const f = fixture({ rendererExited: true })
    await expect(acquireNativeClickAdmission(f.api, { selector: '#one' }, () => {}, f.progress, () => {})).rejects.toMatchObject({ reason: 'TARGET_UNAVAILABLE' })
    expect(f.calls.map(([method]) => method)).toEqual(['Page.getFrameTree', 'Runtime.releaseObjectGroup'])
    expect(f.progress.targetCleanup).toBe('confirmed')
  })
  it('distinguishes an attempted down from its acknowledgement and matching release', () => {
    const p = nativeClickProgress(), publish = vi.fn(), observer = nativeClickObserver(p, publish)
    observer.rawAttempted({ type: 'mousePressed' }); expect(p.downAcknowledged).toBe(0)
    observer.rawAcknowledged({ type: 'mousePressed' }); observer.emergencyReleaseStarted()
    observer.rawAttempted({ type: 'mouseReleased' }); expect(p.upAcknowledged).toBe(0)
    expect(p).toMatchObject({ downAttempted: 1, downAcknowledged: 1, upAttempted: 1, upAcknowledged: 0 })
  })
})

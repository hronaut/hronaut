import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { collectCssProvenance } from '../src/main/browser/css-provenance.js'

function fixture() {
  const debug = Object.assign(new EventEmitter(), { isAttached: () => true, sendCommand: vi.fn() })
  let queries = 0
  debug.sendCommand.mockImplementation(async (method: string) => {
    if (method === 'CSS.enable') debug.emit('message', {}, 'CSS.styleSheetAdded', { header: { styleSheetId: 'sheet', sourceURL: 'https://example.test/a.css', startLine: 0, startColumn: 0 } })
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
    if (method === 'DOM.querySelectorAll') { queries++; return { nodeIds: [2] } }
    if (method === 'CSS.getMatchedStylesForNode') return { matchedCSSRules: [] }
    if (method === 'CSS.getComputedStyleForNode') return { computedStyle: [{ name: 'display', value: 'none' }] }
    return {}
  })
  const contents = { debugger: debug, isDestroyed: () => false } as unknown as WebContents
  const inspect = vi.fn(async () => ({ marker: 'computed-only inspection' }))
  return { debug, contents, inspect, queries: () => queries }
}

describe('read-only CSS protocol collection', () => {
  it('reads fonts only on an eligible leaf without CSS rule retrieval', async () => {
    const f = fixture()
    const original = f.debug.sendCommand.getMockImplementation()!
    f.debug.sendCommand.mockImplementation(async (method: string) => {
      if (method === 'DOM.describeNode') return { node: { nodeId: 2 } }
      if (method === 'CSS.getPlatformFontsForNode') return { fonts: [{ familyName: 'Fixture', postScriptName: 'Fixture', glyphCount: 2, isCustomFont: true }] }
      return original(method)
    })
    const result = await collectCssProvenance(f.contents, '#target', [], () => {}, false, async () => ({ renderedFontsEligible: true }), true)
    expect(result.renderedFonts).toMatchObject({ status: 'observed', fonts: [{ glyphCount: 2 }] })
    expect(f.debug.sendCommand.mock.calls.map(call => call[0])).not.toContain('CSS.getMatchedStylesForNode')
    expect(f.debug.listenerCount('message')).toBe(0)
  })
  it.each(['private', 'shadow', 'pseudo'])('does not query fonts in %s targets', async kind => {
    const f = fixture()
    const original = f.debug.sendCommand.getMockImplementation()!
    f.debug.sendCommand.mockImplementation(async (method: string) => method === 'DOM.describeNode'
      ? { node: { ...(kind === 'shadow' ? { shadowRoots: [{}] } : { pseudoElements: [{}] }) } } : original(method))
    const result = await collectCssProvenance(f.contents, '#target', [], () => {}, false, async () => ({ renderedFontsEligible: kind !== 'private' }), true)
    expect(result.renderedFonts).toMatchObject({ status: 'unavailable', reason: 'unsupported-target' })
    expect(f.debug.sendCommand.mock.calls.map(call => call[0])).not.toContain('CSS.getPlatformFontsForNode')
  })
  it.each(['CSS.fontsUpdated', 'DOM.characterDataModified', 'DOM.childNodeCountUpdated', 'DOM.shadowRootPushed'])('rejects %s during font reads and cleans up', async event => {
    const f = fixture()
    const original = f.debug.sendCommand.getMockImplementation()!
    f.debug.sendCommand.mockImplementation(async (method: string) => {
      if (method === 'DOM.describeNode') return { node: {} }
      if (method === 'CSS.getPlatformFontsForNode') { f.debug.emit('message', {}, event, {}); return { fonts: [] } }
      return original(method)
    })
    await expect(collectCssProvenance(f.contents, '#target', [], () => {}, false, async () => ({ renderedFontsEligible: true }), true)).rejects.toThrow('changed during CSS provenance')
    expect(f.debug.listenerCount('message')).toBe(0)
  })
  it('rejects eligibility changes without a protocol mutation event', async () => {
    const f = fixture()
    const original = f.debug.sendCommand.getMockImplementation()!
    f.debug.sendCommand.mockImplementation(async (method: string) => {
      if (method === 'DOM.describeNode') return { node: {} }
      if (method === 'CSS.getPlatformFontsForNode') return { fonts: [] }
      return original(method)
    })
    const inspect = vi.fn().mockResolvedValueOnce({ renderedFontsEligible: true }).mockResolvedValueOnce({ renderedFontsEligible: false })
    await expect(collectCssProvenance(f.contents, '#target', [], () => {}, false, inspect, true)).rejects.toThrow('editing context changed')
    expect(f.debug.listenerCount('message')).toBe(0)
    expect(f.debug.sendCommand.mock.calls.map(call => call[0])).toContain('CSS.disable')
  })
  it('uses bounded target reads, preserves inspection, and removes domain/listener instrumentation', async () => {
    const f = fixture()
    const result = await collectCssProvenance(f.contents, '#target', ['display'], () => {}, false, f.inspect)
    expect(result.inspection).toEqual({ marker: 'computed-only inspection' })
    expect(result.provenance.computed).toEqual([{ property: 'display', value: 'none' }])
    expect(f.queries()).toBe(2)
    expect(f.debug.sendCommand.mock.calls.map(call => call[0])).toEqual([
      'DOM.enable', 'CSS.enable', 'DOM.getDocument', 'DOM.querySelectorAll', 'CSS.getMatchedStylesForNode',
      'CSS.getComputedStyleForNode', 'DOM.querySelectorAll', 'CSS.disable', 'DOM.disable'
    ])
    expect(f.debug.listenerCount('message')).toBe(0)
  })
  it('preserves the DOM domain needed by rendering overlays', async () => {
    const f = fixture()
    await collectCssProvenance(f.contents, '#target', ['display'], () => {}, true, f.inspect)
    expect(f.debug.sendCommand.mock.calls.map(call => call[0])).not.toContain('DOM.disable')
  })
  it.each(['target', 'stylesheet', 'text'])('rejects %s changes during capture and cleans up', async change => {
    const f = fixture()
    f.inspect.mockImplementation(async () => {
      if (change === 'stylesheet') f.debug.emit('message', {}, 'CSS.styleSheetChanged', {})
      else if (change === 'text') f.debug.emit('message', {}, 'DOM.characterDataModified', {})
      else f.debug.sendCommand.mockImplementation(async method => method === 'DOM.querySelectorAll' ? { nodeIds: [9] } : {})
      return { marker: 'stale' }
    })
    await expect(collectCssProvenance(f.contents, '#target', ['display'], () => {}, false, f.inspect)).rejects.toThrow('changed during CSS')
    expect(f.debug.listenerCount('message')).toBe(0)
    expect(f.debug.sendCommand.mock.calls.map(call => call[0])).toContain('CSS.disable')
  })
  it('cleans up when context validation fails immediately after CSS enable', async () => {
    const f = fixture()
    const assertCurrent = () => { if (f.debug.sendCommand.mock.calls.some(call => call[0] === 'CSS.enable')) throw new Error('context changed') }
    await expect(collectCssProvenance(f.contents, '#target', ['display'], assertCurrent, false, f.inspect)).rejects.toThrow('context changed')
    expect(f.debug.sendCommand.mock.calls.map(call => call[0])).toContain('CSS.disable')
    expect(f.debug.listenerCount('message')).toBe(0)
  })
  it('rejects ambiguous targets before reading declarations', async () => {
    const f = fixture()
    const original = f.debug.sendCommand.getMockImplementation()!
    f.debug.sendCommand.mockImplementation(async method => method === 'DOM.querySelectorAll' ? { nodeIds: [2, 3] } : original(method))
    await expect(collectCssProvenance(f.contents, '.many', ['display'], () => {}, false, f.inspect)).rejects.toThrow('exactly one')
    expect(f.debug.sendCommand.mock.calls.map(call => call[0])).not.toContain('CSS.getMatchedStylesForNode')
  })
})

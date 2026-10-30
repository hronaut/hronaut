import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import {
  frameObservationCheckScript,
  frameObservationReadScript,
  frameObservationScript,
  frameReleaseScript,
  frameSelectionScript
} from '../src/main/browser/frame-observation/frame-observation-script.js'

describe('frame script literal boundaries', () => {
  it.each([
    '</script><script>globalThis.injected=true</script>',
    'x\u2028y\u2029z',
    '\");globalThis.injected=true;//',
    '\\"\n\t'
  ])('preserves selector data without creating executable syntax: %j', selector => {
    let received: unknown
    const frame = { localName: 'iframe', matches: (value: unknown) => { received = value; return true } }
    let visited = false
    const context = {
      document: { createTreeWalker: () => ({ currentNode: frame, nextNode: () => { if (visited) return false; visited = true; return true } }) },
      NodeFilter: { SHOW_ELEMENT: 1 }, performance: { now: () => 0 }, injected: false
    } as Record<string, unknown>
    const source = frameSelectionScript('__frame_test', selector)
    expect(vm.runInNewContext(source, context, { timeout: 1000 })).toBe(frame)
    expect(context.__frame_test).toMatchObject({ frame })
    expect(received).toBe(selector)
    expect(context.injected).toBe(false)
    // The shared literal contract also escapes HTML terminators and separators;
    // these checks are hardening invariants, not an asserted HTML sink here.
    expect(source).not.toContain('</script>')
    expect(source).not.toMatch(/[\u2028\u2029]/)
    const capture = frameObservationScript('__frame_test', selector, 1000)
    expect(() => new vm.Script(capture)).not.toThrow()
    expect(capture).not.toContain('</script>')
    expect(capture).not.toMatch(/[\u2028\u2029]/)
  })
})

describe('what the frame observation keeps in its private world', () => {
  const held = (value: Record<string, unknown>): Record<string, unknown> => vm.createContext({ __frame_test: value })

  it('reads the observation held under its key, then checks and forgets it', () => {
    const close = vi.fn()
    const context = held({ frame: {}, read: () => ({ text: 'Frame text', omissions: [] }), check: () => true, close })
    expect(vm.runInContext(frameObservationReadScript('__frame_test'), context)).toEqual({ text: 'Frame text', omissions: [] })
    expect(vm.runInContext(frameObservationCheckScript('__frame_test'), context)).toBe(true)
    expect(close).toHaveBeenCalledOnce()
    expect('__frame_test' in context).toBe(false)
    expect(vm.runInContext(frameObservationCheckScript('__frame_test'), context)).toBe(false)
  })

  it('closes a frame that changed, and refuses one held only as a selection', () => {
    const close = vi.fn()
    const changed = held({ frame: {}, read: () => null, check: () => false, close })
    expect(vm.runInContext(frameObservationCheckScript('__frame_test'), changed)).toBe(false)
    expect(close).toHaveBeenCalledOnce()
    expect('__frame_test' in changed).toBe(false)
    expect(() => vm.runInContext(frameObservationCheckScript('__frame_test'), held({ frame: {}, close }))).toThrow(/check is not a function/)
  })

  it('releases what its key holds, or nothing', () => {
    const close = vi.fn()
    const context = held({ frame: {}, close })
    expect(vm.runInContext(frameReleaseScript('__frame_test'), context)).toBe(true)
    expect(close).toHaveBeenCalledOnce()
    expect('__frame_test' in context).toBe(false)
    expect(vm.runInContext(frameReleaseScript('__frame_test'), context)).toBe(true)
  })
})

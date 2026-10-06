import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { frameObservationScript, frameSelectorScript } from '../src/main/browser/frame-observation-script.js'

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
    }
    const source = frameSelectorScript(selector)
    expect(vm.runInNewContext(source, context, { timeout: 1000 })).toBe(frame)
    expect(received).toBe(selector)
    expect(context.injected).toBe(false)
    // The shared literal contract also escapes HTML terminators and separators;
    // these checks are hardening invariants, not an asserted HTML sink here.
    expect(source).not.toContain('</script>')
    expect(source).not.toMatch(/[\u2028\u2029]/)
    const capture = frameObservationScript(selector, 1000, 'expectedFrame')
    expect(() => new vm.Script(capture)).not.toThrow()
    expect(capture).not.toContain('</script>')
    expect(capture).not.toMatch(/[\u2028\u2029]/)
  })
})

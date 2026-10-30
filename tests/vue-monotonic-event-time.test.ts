import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { vueMonotonicEventTime, withMonotonicEventTime } from '../scripts/vue-monotonic-event-time.ts'

const VUE_DOM_RUNTIME = 'node_modules/@vue/runtime-dom/dist/runtime-dom.esm-bundler.js'

describe('Vue event times from the monotonic clock', () => {
  it('reads the installed Vue\'s listener and event times from the monotonic clock', async () => {
    const source = await readFile(VUE_DOM_RUNTIME, 'utf8')
    expect(source).toMatch(/e\._vts = Date\.now\(\)/)

    const patched = withMonotonicEventTime(source)

    expect(patched).not.toMatch(/(cachedNow|_vts)\s*=\s*Date\.now\(\)/)
    expect(patched).toMatch(/cachedNow = performance\.now\(\)/)
    expect(patched).toMatch(/e\._vts = performance\.now\(\)/)
    expect(patched.replaceAll('performance.now()', 'Date.now()')).toBe(source)
  })

  it('fails when Vue no longer reads the wall clock where expected', () => {
    expect(() => withMonotonicEventTime('const getNow = () => Date.now()')).toThrow(/@vue\/runtime-dom has 0 matches/)
    expect(() => withMonotonicEventTime('cachedNow = Date.now(); e._vts = Date.now(); e._vts = Date.now()')).toThrow(/has 2 matches/)
  })

  it('changes only Vue\'s DOM runtime and fails a renderer build without it', async () => {
    const plugin = vueMonotonicEventTime()
    const transform = plugin.transform as (code: string, id: string) => { code: string } | null
    const generateBundle = plugin.generateBundle as (this: { error(message: string): never }) => void
    const context = { error: vi.fn((message: string): never => { throw new Error(message) }) }

    expect(transform('e._vts = Date.now()', '/app/src/renderer/src/main.ts')).toBeNull()
    expect(() => generateBundle.call(context)).toThrow(/no @vue\/runtime-dom esm-bundler build/)

    const source = await readFile(VUE_DOM_RUNTIME, 'utf8')
    expect(transform(source, `/app/${VUE_DOM_RUNTIME}`)?.code).toMatch(/e\._vts = performance\.now\(\)/)
    expect(() => generateBundle.call(context)).not.toThrow()
  })
})

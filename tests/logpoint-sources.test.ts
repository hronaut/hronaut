import { describe, expect, it, vi } from 'vitest'
import { AnyMap } from '@jridgewell/trace-mapping'
import {
  describeScript,
  documentScripts,
  generatedPositions,
  loadSourceMap,
  originalLocation,
  scriptRecord,
  scriptUrl,
  sessionMapFetch,
  sourceMatches,
  type MapFetch,
  type LogpointScriptRecord,
  type SourceMapBudget
} from '../src/main/browser/logpoints/logpoint-sources.js'

const ORIGIN = 'https://shop.test'
// esbuild's map of src/cart.ts bundled with src/a/format.ts and src/b/format.ts; cart.ts line 10 runs on bundle line 17.
const MAP = {
  version: 3 as const,
  sources: ['../src/a/format.ts', '../src/b/format.ts', '../src/cart.ts'],
  mappings: ';;AAAO,WAAS,QAAQ,OAAuB;AAC7C,WAAO,IAAI,KAAK;AAAA,EAClB;;;ACFO,WAAS,QAAQ,OAAuB;AAC7C,WAAO,IAAI,KAAK;AAAA,EAClB;;;ACEA,MAAM,QAAQ,EAAE,QAAQ,GAAG,MAAM,IAAI;AAE9B,WAAS,MAAM,OAAuB;AAC3C,QAAI,MAAM;AACV,eAAW,QAAQ,OAAO;AACxB,aAAO,KAAK,QAAQ,KAAK;AAAA,IAC3B;AACA,UAAM,WAAW,MAAM,MAAM,KAAK;AAClC,UAAM,UAAU;AAChB,WAAO,MAAM;AAAA,EACf;AAEA,WAAS,KAAK,GAAmB;AAC/B,QAAI,MAAM;AACV,aAAS,IAAI,GAAG,IAAI,GAAG,KAAK;AAC1B,aAAO,MAAM,KAAK;AAAA,IACpB;AACA,WAAO;AAAA,EACT;AAEA,MAAM,IAAI;AACV,IAAE,QAAQ;AACV,IAAE,WAAW,CAAC,UAAkB,MAAM,KAAK;AAC3C,IAAE,OAAO,CAAC,MAAc,KAAK,CAAC;AAC9B,IAAE,SAAS,CAAC,UAAkB,CAAC,QAAQ,KAAK,GAAG,QAAQ,KAAK,CAAC;AAC7D,IAAE,cAAc,MAAM;AAAE;AAAU,MAAE,gBAAgB;AAAA,EAAE;AACtD,IAAE,QAAQ;AACV,cAAY,MAAM;AAAE,MAAE,QAAS,EAAE,QAAmB;AAAA,EAAE,GAAG,EAAE;',
  names: [],
  sourcesContent: ['// SOURCE-CONTENT-CANARY a', '// SOURCE-CONTENT-CANARY b', '// SOURCE-CONTENT-CANARY cart']
}

function script(overrides: Partial<LogpointScriptRecord> = {}): LogpointScriptRecord {
  return {
    scriptId: '6', url: `${ORIGIN}/bundle.js`, rawUrl: `${ORIGIN}/bundle.js?v=1`, hash: 'h1', executionContextId: 1,
    frameId: 'main', isDefault: true, startLine: 0, endLine: 40, ...overrides
  }
}

const budget = (overrides: Partial<SourceMapBudget> = {}): SourceMapBudget => ({ remainingBytes: 64 * 1024 * 1024, deadline: performance.now() + 10_000, ...overrides })

/** The tab's session serving one body in chunks of the given size, or a 404 without one; records whether the body was cancelled. */
function network(body: string | undefined, chunkSize = 1024 * 1024) {
  const state = { cancelled: false }
  const fetchMap = vi.fn(async (_url: string, _signal: AbortSignal): Promise<Response> => {
    if (body === undefined) return new Response(null, { status: 404 })
    let offset = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= body.length) return controller.close()
        controller.enqueue(new TextEncoder().encode(body.slice(offset, offset + chunkSize)))
        offset += chunkSize
      },
      cancel() { state.cancelled = true }
    })
    return new Response(stream, { status: 200 })
  })
  return Object.assign(fetchMap as typeof fetchMap & MapFetch, { state })
}

describe('script addresses and records', () => {
  it('keeps only an HTTP(S) script\'s origin and path, never its credentials, query or fragment', () => {
    expect(scriptUrl('https://user:secret@shop.test/js/app.js?token=private#x')).toBe('https://shop.test/js/app.js')
    for (const url of ['', 'data:text/javascript,1', 'chrome-extension://abc/x.js', 'not a url', 42]) expect(scriptUrl(url)).toBeUndefined()
    expect(scriptUrl(`${ORIGIN}/${'a'.repeat(600)}.js`)).toBeUndefined()
  })

  it('reads a scriptParsed event, and ignores one without its identity', () => {
    expect(scriptRecord({
      scriptId: '6', url: `${ORIGIN}/bundle.js?v=1`, hash: 'h1', executionContextId: 3, startLine: 4, endLine: 9, sourceMapURL: 'bundle.js.map',
      executionContextAuxData: { frameId: 'main', isDefault: true }
    })).toEqual({ scriptId: '6', url: `${ORIGIN}/bundle.js`, rawUrl: `${ORIGIN}/bundle.js?v=1`, hash: 'h1', executionContextId: 3, frameId: 'main', isDefault: true, startLine: 4, endLine: 9, sourceMapUrl: 'bundle.js.map' })
    expect(scriptRecord({ scriptId: '6', hash: 'h1' })).toBeUndefined()
    expect(scriptRecord(undefined)).toBeUndefined()
  })

  it('lists the page\'s own HTTP(S) scripts of the given frames once each, by address', () => {
    const scripts = [
      script({ scriptId: '9', url: `${ORIGIN}/z.js`, hash: 'z' }),
      script({ scriptId: '7' }),
      // The same bundle in a same-origin frame.
      script({ scriptId: '12', frameId: 'frame' }),
      script({ scriptId: '8', url: `${ORIGIN}/app`, hash: 'inline' }),
      script({ scriptId: '10', url: undefined, hash: 'eval' }),
      script({ scriptId: '11', url: `${ORIGIN}/isolated.js`, isDefault: false }),
      script({ scriptId: '13', url: `${ORIGIN}/other-frame.js`, frameId: 'cross-origin' })
    ]
    expect(documentScripts(scripts, new Set(['main', 'frame'])).map(entry => entry.scriptId)).toEqual(['8', '7', '9'])
  })
})

describe('source names', () => {
  it('matches a source by its whole path segments, ignoring a bundler scheme and dot segments', () => {
    expect(sourceMatches('../src/cart.ts', 'src/cart.ts')).toBe(true)
    expect(sourceMatches('../src/cart.ts', 'cart.ts')).toBe(true)
    expect(sourceMatches('webpack://shop/./src/cart.ts', 'src/cart.ts')).toBe(true)
    expect(sourceMatches('webpack://shop/./src/cart.ts', 'webpack://shop/./src/cart.ts')).toBe(true)
    expect(sourceMatches('../src/cart.ts', 'art.ts')).toBe(false)
    expect(sourceMatches('../src/cart.ts', 'lib/cart.ts')).toBe(false)
    expect(sourceMatches('cart.ts', 'src/cart.ts')).toBe(false)
    expect(sourceMatches('../src/cart.ts', '')).toBe(false)
  })

  it('maps a source line to the generated code and back', () => {
    const map = new AnyMap(MAP)
    expect(generatedPositions(map, '../src/cart.ts', 10)).toEqual([{ line: 17, column: 0 }])
    expect(generatedPositions(map, '../src/cart.ts', 10, 5)).toEqual([{ line: 17, column: 0 }])
    // Line 3 of cart.ts is a type declaration that compiles to nothing.
    expect(generatedPositions(map, '../src/cart.ts', 3)).toEqual([])
    expect(originalLocation(map, 17, 6)).toEqual({ source: '../src/cart.ts', line: 10, column: 5 })
    expect(originalLocation(map, 1, 0)).toBeUndefined()
  })
})

describe('source maps', () => {
  it('reads an inline map, and lists its source names but never their contents', async () => {
    const inline = `data:application/json;base64,${Buffer.from(JSON.stringify(MAP)).toString('base64')}`
    const send = network(undefined)
    const loaded = await loadSourceMap(send, script({ sourceMapUrl: inline }), budget())
    expect(send).not.toHaveBeenCalled()
    const described = describeScript(script({ sourceMapUrl: inline }), loaded)
    expect(described).toEqual({ url: `${ORIGIN}/bundle.js`, sourceMap: 'loaded', sources: MAP.sources })
    expect(JSON.stringify(described)).not.toContain('SOURCE-CONTENT-CANARY')
    expect(await loadSourceMap(send, script({ sourceMapUrl: 'data:text/html,<p>' }), budget())).toEqual({ problem: 'unsupported-url' })
    expect(await loadSourceMap(send, script({ sourceMapUrl: 'data:application/json,{not json' }), budget())).toEqual({ problem: 'invalid' })
  })

  it('fetches a map through the tab\'s session without credentials, in chunks', async () => {
    const body = `)]}'\n${JSON.stringify(MAP)}`
    const send = network(body, 100)
    const loaded = await loadSourceMap(send, script({ sourceMapUrl: 'bundle.js.map' }), budget())
    expect('map' in loaded && loaded.sources).toEqual(MAP.sources)
    expect(send).toHaveBeenCalledWith(`${ORIGIN}/bundle.js.map`, expect.any(AbortSignal))

    const cdn = network(JSON.stringify(MAP))
    await loadSourceMap(cdn, script({ rawUrl: 'https://cdn.test/bundle.js', sourceMapUrl: 'bundle.js.map' }), budget())
    expect(cdn).toHaveBeenCalledWith('https://cdn.test/bundle.js.map', expect.any(AbortSignal))

    // The session is asked to leave out cookies and other credentials, which applies to redirects too.
    const session = { fetch: vi.fn(async () => new Response(JSON.stringify(MAP))) }
    expect('map' in await loadSourceMap(sessionMapFetch(session), script({ sourceMapUrl: 'bundle.js.map' }), budget())).toBe(true)
    expect(session.fetch).toHaveBeenCalledWith(`${ORIGIN}/bundle.js.map`, { credentials: 'omit', signal: expect.any(AbortSignal) })
  })

  it('gives up on a map that does not arrive in time', async () => {
    vi.useFakeTimers()
    try {
      const hanging: MapFetch = async (_url, signal) => await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
      const pending = loadSourceMap(hanging, script({ sourceMapUrl: 'bundle.js.map' }), budget())
      await vi.advanceTimersByTimeAsync(5_001)
      expect(await pending).toEqual({ problem: 'timeout' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('counts an inline map against the call\'s budget, and keeps no address too long to be one Hronaut reads', async () => {
    const inline = `data:application/json;base64,${Buffer.from(JSON.stringify(MAP)).toString('base64')}`
    const bytes = Buffer.byteLength(JSON.stringify(MAP))
    const shared = budget({ remainingBytes: bytes + 10 })
    expect('map' in await loadSourceMap(network(undefined), script({ sourceMapUrl: inline }), shared)).toBe(true)
    expect(shared.remainingBytes).toBe(10)
    expect(await loadSourceMap(network(undefined), script({ sourceMapUrl: inline }), shared)).toEqual({ problem: 'too-large' })

    const huge = scriptRecord({
      scriptId: '6', url: `${ORIGIN}/bundle.js?${'q'.repeat(5_000)}`, hash: 'h1', executionContextId: 1,
      sourceMapURL: `data:application/json;base64,${'A'.repeat(23 * 1024 * 1024)}`, executionContextAuxData: { frameId: 'main', isDefault: true }
    })!
    expect(huge).toMatchObject({ url: `${ORIGIN}/bundle.js`, rawUrl: `${ORIGIN}/bundle.js`, sourceMapTooLarge: true })
    expect(huge.sourceMapUrl).toBeUndefined()
    expect(await loadSourceMap(network(undefined), huge, budget())).toEqual({ problem: 'too-large' })
    expect(describeScript(huge, undefined)).toEqual({ url: `${ORIGIN}/bundle.js`, sourceMap: 'unavailable', sourceMapProblem: 'too-large' })
  })

  it('says why a map could not be read, within the call\'s byte and time budget', async () => {
    expect(await loadSourceMap(network(undefined), script({ sourceMapUrl: 'bundle.js.map' }), budget())).toEqual({ problem: 'fetch-failed' })
    expect(await loadSourceMap(network('{}'), script({ sourceMapUrl: 'file:///etc/passwd' }), budget())).toEqual({ problem: 'unsupported-url' })
    const large = network(JSON.stringify(MAP), 100)
    const small = budget({ remainingBytes: 150 })
    expect(await loadSourceMap(large, script({ sourceMapUrl: 'bundle.js.map' }), small)).toEqual({ problem: 'too-large' })
    expect(large.state.cancelled).toBe(true)
    expect(small.remainingBytes).toBe(0)
    expect(await loadSourceMap(network('{}'), script({ sourceMapUrl: 'bundle.js.map' }), small)).toEqual({ problem: 'too-large' })
    expect(await loadSourceMap(network('{}'), script({ sourceMapUrl: 'bundle.js.map' }), budget({ deadline: performance.now() - 1 }))).toEqual({ problem: 'timeout' })
    expect(await loadSourceMap(network('[1, 2]'), script({ sourceMapUrl: 'bundle.js.map' }), budget())).toEqual({ problem: 'invalid' })
    expect(describeScript(script({ sourceMapUrl: 'bundle.js.map' }), { problem: 'timeout' })).toEqual({ url: `${ORIGIN}/bundle.js`, sourceMap: 'unavailable', sourceMapProblem: 'timeout' })
    expect(describeScript(script({ sourceMapUrl: 'bundle.js.map' }), 'not-checked')).toEqual({ url: `${ORIGIN}/bundle.js`, sourceMap: 'not-checked' })
    expect(describeScript(script(), undefined)).toEqual({ url: `${ORIGIN}/bundle.js`, sourceMap: 'none' })
  })

  it('bounds the listed source names and strips characters that could disguise them', async () => {
    const sources = Array.from({ length: 205 }, (_, index) => `src/${index}.ts`)
    sources[0] = `src/‮evil\u0000.ts${'x'.repeat(600)}`
    const inline = `data:application/json,${encodeURIComponent(JSON.stringify({ version: 3, sources, mappings: '', names: [] }))}`
    const described = describeScript(script({ sourceMapUrl: inline }), await loadSourceMap(network(undefined), script({ sourceMapUrl: inline }), budget()))
    expect(described.sources).toHaveLength(200)
    expect(described.sourcesTruncated).toBe(true)
    expect(described.sources![0]).toMatch(/^src\/evil\.tsx+…$/)
    expect(described.sources![0]).toHaveLength(512)
  })
})

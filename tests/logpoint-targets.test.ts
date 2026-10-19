import { describe, expect, it, vi } from 'vitest'
import { AnyMap } from '@jridgewell/trace-mapping'
import type { CdpSend, LoadedSourceMap, LogpointScriptRecord } from '../src/main/browser/logpoints/logpoint-sources.js'
import { resolveTarget, validRequest } from '../src/main/browser/logpoints/logpoint-targets.js'

const ORIGIN = 'https://shop.test'
const MAP = {
  version: 3 as const,
  sources: ['../src/a/format.ts', '../src/b/format.ts', '../src/cart.ts'],
  mappings: ';;AAAO,WAAS,QAAQ,OAAuB;AAC7C,WAAO,IAAI,KAAK;AAAA,EAClB;;;ACFO,WAAS,QAAQ,OAAuB;AAC7C,WAAO,IAAI,KAAK;AAAA,EAClB;;;ACEA,MAAM,QAAQ,EAAE,QAAQ,GAAG,MAAM,IAAI;AAE9B,WAAS,MAAM,OAAuB;AAC3C,QAAI,MAAM;AACV,eAAW,QAAQ,OAAO;AACxB,aAAO,KAAK,QAAQ,KAAK;AAAA,IAC3B;AACA,UAAM,WAAW,MAAM,MAAM,KAAK;AAClC,UAAM,UAAU;AAChB,WAAO,MAAM;AAAA,EACf;AAEA,WAAS,KAAK,GAAmB;AAC/B,QAAI,MAAM;AACV,aAAS,IAAI,GAAG,IAAI,GAAG,KAAK;AAC1B,aAAO,MAAM,KAAK;AAAA,IACpB;AACA,WAAO;AAAA,EACT;AAEA,MAAM,IAAI;AACV,IAAE,QAAQ;AACV,IAAE,WAAW,CAAC,UAAkB,MAAM,KAAK;AAC3C,IAAE,OAAO,CAAC,MAAc,KAAK,CAAC;AAC9B,IAAE,SAAS,CAAC,UAAkB,CAAC,QAAQ,KAAK,GAAG,QAAQ,KAAK,CAAC;AAC7D,IAAE,cAAc,MAAM;AAAE;AAAU,MAAE,gBAAgB;AAAA,EAAE;AACtD,IAAE,QAAQ;AACV,cAAY,MAAM;AAAE,MAAE,QAAS,EAAE,QAAmB;AAAA,EAAE,GAAG,EAAE;',
  names: []
}

function script(overrides: Partial<LogpointScriptRecord> = {}): LogpointScriptRecord {
  return {
    scriptId: '6', url: `${ORIGIN}/bundle.js`, rawUrl: `${ORIGIN}/bundle.js`, hash: 'h1', executionContextId: 1,
    frameId: 'main', isDefault: true, startLine: 0, endLine: 40, sourceMapUrl: 'bundle.js.map', ...overrides
  }
}

function loaded(sources = MAP.sources): LoadedSourceMap {
  const map = new AnyMap({ ...MAP, sources })
  return { map, sources }
}

async function resolve(request: Parameters<typeof validRequest>[0], scripts: LogpointScriptRecord[], maps = new Map<string, LoadedSourceMap>([['6', loaded()]])) {
  const send = vi.fn(async () => ({}))
  const target = await resolveTarget(send as unknown as CdpSend, 'Logpoint 1', request, scripts, maps, 'main', { remainingBytes: 1024, deadline: Date.now() + 1_000 })
  return { target, send }
}

describe('requested logpoints', () => {
  it('checks each logpoint before anything reaches the page', () => {
    expect(validRequest({ source: 'cart.ts', line: 10, expression: '  sum  ' }, 'Logpoint 1')).toEqual({ source: 'cart.ts', line: 10, expression: 'sum' })
    expect(() => validRequest({ source: 'cart.ts', line: 10, expression: ' ' }, 'Logpoint 1')).toThrow('Logpoint 1: give an expression of 1 to 500 characters')
    expect(() => validRequest({ source: 'cart.ts', line: 10, expression: 'x'.repeat(501) }, 'Logpoint 2')).toThrow('Logpoint 2: give an expression')
    expect(() => validRequest({ line: 10, expression: 'sum' }, 'Logpoint 1')).toThrow('give the script\'s url, a source from its source map, or both')
    expect(() => validRequest({ url: '', line: 10, expression: 'sum' }, 'Logpoint 1')).toThrow('url must be 1 to 512 characters')
    expect(() => validRequest({ source: '', line: 10, expression: 'sum' }, 'Logpoint 1')).toThrow('source must be 1 to 512 characters')
    expect(() => validRequest({ source: 'cart.ts', line: 0, expression: 'sum' }, 'Logpoint 1')).toThrow('line must be a positive integer')
    expect(() => validRequest({ source: 'cart.ts', line: 1.5, expression: 'sum' }, 'Logpoint 1')).toThrow('line must be a positive integer')
    expect(() => validRequest({ source: 'cart.ts', line: 1, column: 0, expression: 'sum' }, 'Logpoint 1')).toThrow('column must be a positive integer')
  })
})

describe('resolving a logpoint', () => {
  it('maps a source line through the script\'s source map to the generated code', async () => {
    const { target } = await resolve({ source: 'src/cart.ts', line: 10, expression: 'sum' }, [script()])
    expect(target).toMatchObject({ script: { scriptId: '6' }, line: 16, column: 0, generatedMatches: 1 })
  })

  it('takes a script address and line as given, choosing an inline script by its lines', async () => {
    expect((await resolve({ url: `${ORIGIN}/bundle.js?build=2`, line: 17, column: 7, expression: 'sum' }, [script()])).target).toEqual({ script: script(), line: 16, column: 6 })
    const inline = [
      script({ scriptId: '1', url: `${ORIGIN}/app`, hash: 'first', startLine: 2, endLine: 4, sourceMapUrl: undefined }),
      script({ scriptId: '2', url: `${ORIGIN}/app`, hash: 'second', startLine: 9, endLine: 20, sourceMapUrl: undefined })
    ]
    expect((await resolve({ url: `${ORIGIN}/app`, line: 12, expression: 'x' }, inline)).target.script.scriptId).toBe('2')
    await expect(resolve({ url: `${ORIGIN}/app`, line: 7, expression: 'x' }, inline)).rejects.toThrow('Logpoint 1: no script at that url has code on that line')
    await expect(resolve({ url: `${ORIGIN}/app`, line: 3, expression: 'x' }, [...inline, script({ scriptId: '3', url: `${ORIGIN}/app`, hash: 'other', startLine: 0, endLine: 5 })]))
      .rejects.toThrow('the page runs more than one different script at that url')
    await expect(resolve({ url: `${ORIGIN}/nope.js`, line: 3, expression: 'x' }, inline)).rejects.toThrow('no script of the top-level page is at that url; list them with action scripts')
  })

  it('says why a source cannot be resolved', async () => {
    await expect(resolve({ source: 'format.ts', line: 2, expression: 'value' }, [script()])).rejects.toThrow('Logpoint 1: 2 sources match; give a longer path, such as one of: "../src/a/format.ts", "../src/b/format.ts"')
    await expect(resolve({ source: 'nothing.ts', line: 2, expression: 'value' }, [script()])).rejects.toThrow('no source map of the top-level page that loaded lists that source')
    await expect(resolve({ source: 'src/cart.ts', line: 3, expression: 'value' }, [script()])).rejects.toThrow('no code maps to that line of the source')
    // Another bundle listing the same source needs the script's address to choose.
    const maps = new Map<string, LoadedSourceMap>([['6', loaded()], ['7', loaded()]])
    await expect(resolve({ source: 'src/cart.ts', line: 10, expression: 'sum' }, [script(), script({ scriptId: '7', url: `${ORIGIN}/legacy.js`, hash: 'h2' })], maps))
      .rejects.toThrow(`more than one script maps that source; add url to choose one of: ${ORIGIN}/bundle.js, ${ORIGIN}/legacy.js`)
    // The same bundle twice, as in a frame of the page, is one match.
    expect((await resolve({ source: 'src/cart.ts', line: 10, expression: 'sum' }, [script(), script({ scriptId: '7', frameId: 'frame' })], maps)).target.script.scriptId).toBe('6')
  })

  it('reads a source map only when a source is asked for, once for each script', async () => {
    const maps = new Map<string, LoadedSourceMap>()
    const { send } = await resolve({ url: `${ORIGIN}/bundle.js`, line: 17, expression: 'sum' }, [script()], maps)
    expect(send).not.toHaveBeenCalled()
    await expect(resolve({ source: 'src/cart.ts', line: 10, expression: 'sum' }, [script()], maps)).rejects.toThrow('no source map of the top-level page that loaded lists that source')
    expect(maps.get('6')).toEqual({ problem: 'fetch-failed' })
  })
})

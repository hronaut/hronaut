import { createRequire } from 'node:module'
import { SourceMapConsumer, SourceMapGenerator, type RawSourceMap } from 'source-map-js'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const expressRequire = createRequire(require.resolve('express'))
const proxyAddr = expressRequire('proxy-addr') as {
  compile: (subnet: string) => (address: string) => boolean
}

describe('production dependency security regressions', () => {
  // GHSA-jqcg-44mw-7w3h. This exercises the dependency's subnet matcher,
  // not Hronaut's configuration (which leaves trust proxy disabled).
  it.each(['::ffff:10.0.0.0/8', '::/1'])(
    'does not trust arbitrary IPv4 addresses through IPv6 subnet %s', subnet => {
      expect(proxyAddr.compile(subnet)('192.0.2.10')).toBe(false)
    }
  )

  it.each(['10.0.0.0/8', '::ffff:10.0.0.0/104'])(
    'preserves correctly specified IPv4 trust subnet %s', subnet => {
      const trust = proxyAddr.compile(subnet)
      expect(trust('10.2.3.4')).toBe(true)
      expect(trust('::ffff:10.2.3.4')).toBe(true)
      expect(trust('192.0.2.10')).toBe(false)
    }
  )

  it('preserves ordinary IPv6 trust subnet matching', () => {
    const trust = proxyAddr.compile('2001:db8::/32')
    expect(trust('2001:db8:1::1')).toBe(true)
    expect(trust('2001:db9::1')).toBe(false)
  })

  const flatMap: RawSourceMap = {
    version: '3', file: 'fixture.js', sources: ['fixture.ts'], names: [], mappings: 'AAAA',
    sourcesContent: ['const fixture = true']
  }
  const indexedMap = (line: number, column = 0) => ({
    version: 3, sections: [{ offset: { line, column }, map: flatMap }]
  })

  // GHSA-68fv-2mgg-jv7q. Only construct the consumer: never serialize or
  // expand an oversized map, even when running against the vulnerable version.
  it.each([10_000_001, -1, 0.5])('rejects invalid indexed source-map line offset %s', line => {
    expect(() => new SourceMapConsumer(indexedMap(line) as unknown as RawSourceMap)).toThrow()
  })

  it('bounds accumulated offsets across nested indexed source maps', () => {
    const nested = {
      version: 3,
      sections: [{ offset: { line: 6_000_000, column: 0 }, map: indexedMap(6_000_000) }]
    }
    expect(() => new SourceMapConsumer(nested as unknown as RawSourceMap)).toThrow()
  })

  it('preserves ordinary indexed mappings and embedded source content', () => {
    // The package's declarations omit the supported indexed-map input shape.
    const consumer = new SourceMapConsumer(indexedMap(2) as unknown as RawSourceMap)
    const mappings: unknown[] = []
    consumer.eachMapping(mapping => mappings.push(mapping))
    expect(mappings).toEqual([expect.objectContaining({
      source: 'fixture.ts', originalLine: 1, originalColumn: 0,
      generatedLine: 3, generatedColumn: 0
    })])
    expect(consumer.sourceContentFor('fixture.ts')).toBe('const fixture = true')
  })

  it('preserves ordinary flat source maps through a generator round trip', () => {
    const generated = SourceMapGenerator.fromSourceMap(new SourceMapConsumer(flatMap))
    const roundTrip = new SourceMapConsumer(generated.toJSON())
    expect(roundTrip.originalPositionFor({ line: 1, column: 0 }))
      .toMatchObject({ source: 'fixture.ts', line: 1, column: 0 })
    expect(roundTrip.sourceContentFor('fixture.ts')).toBe('const fixture = true')
  })
})

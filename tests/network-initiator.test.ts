import { describe, expect, it } from 'vitest'
import {
  MAX_NETWORK_INITIATOR_FRAMES,
  normalizeNetworkInitiator
} from '../src/shared/network-initiator.js'

describe('network request initiator normalization', () => {
  it('keeps useful parser source locations while redacting URL credentials', () => {
    expect(normalizeNetworkInitiator({
      type: 'parser',
      url: 'https://person:private@example.test/app?token=secret&view=source#fragment',
      lineNumber: 9,
      columnNumber: 4
    })).toEqual({
      type: 'parser',
      url: 'https://%5BREDACTED%5D:%5BREDACTED%5D@example.test/app?view=source&token=%5BREDACTED%5D',
      lineNumber: 10,
      columnNumber: 5
    })
  })

  it('flattens bounded script stacks and omits inline data sources', () => {
    const frames = Array.from({ length: MAX_NETWORK_INITIATOR_FRAMES + 3 }, (_, index) => ({
      functionName: index === 0 ? 'load token=private' : `load${index}`,
      url: index === 0 ? 'data:text/javascript,private-source' : `https://example.test/app-${index}.js`,
      lineNumber: index,
      columnNumber: index + 1
    }))
    const result = normalizeNetworkInitiator({ type: 'script', stack: { callFrames: frames } })
    expect(result).toMatchObject({ type: 'script', stackTruncated: true })
    expect(result?.stack).toHaveLength(MAX_NETWORK_INITIATOR_FRAMES)
    expect(result?.stack?.[0]).toEqual({ functionName: 'load token=[REDACTED]', lineNumber: 1, columnNumber: 2 })
    expect(result?.stack?.[1]).toEqual({
      functionName: 'load1',
      url: 'https://example.test/app-1.js',
      lineNumber: 2,
      columnNumber: 3
    })
  })

  it('records sanitized redirect ancestry without requiring another initiator', () => {
    expect(normalizeNetworkInitiator(undefined, 'https://example.test/login?access_token=private#result')).toEqual({
      type: 'redirect',
      redirectedFrom: 'https://example.test/login?access_token=%5BREDACTED%5D'
    })
    expect(normalizeNetworkInitiator(undefined)).toBeUndefined()
  })

  it('keeps Chromium relationship IDs out of the public initiator', () => {
    expect(normalizeNetworkInitiator({ type: 'preflight', requestId: 'raw-cdp-request-id' })).toEqual({
      type: 'preflight'
    })
  })
})

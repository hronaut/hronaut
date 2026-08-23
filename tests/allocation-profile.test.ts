import { describe, expect, it } from 'vitest'
import { ALLOCATION_PROFILE_LIMITS, summarizeAllocationProfile } from '../src/shared/allocation-profile.js'

describe('allocation profile summary', () => {
  it('aggregates sampled live bytes by sanitized function location', () => {
    const result = summarizeAllocationProfile({
      head: {
        id: 1,
        callFrame: { functionName: '(root)' },
        selfSize: 0,
        children: [
          {
            id: 2,
            callFrame: { functionName: 'buildRows', url: 'https://app.test/main.js?token=secret', lineNumber: 9, columnNumber: 4 },
            selfSize: 65_536,
            children: [{
              id: 3,
              callFrame: { functionName: 'save', url: 'https://app.test/main.js', lineNumber: 19, columnNumber: 2 },
              selfSize: 32_768
            }]
          },
          {
            id: 4,
            callFrame: { functionName: 'buildRows', url: 'https://app.test/main.js?token=secret', lineNumber: 9, columnNumber: 4 },
            selfSize: 32_768
          }
        ]
      },
      samples: [
        { size: 65_536, nodeId: 2 },
        { size: 32_768, nodeId: 3 },
        { size: 32_768, nodeId: 4 }
      ]
    }, (url) => url.replace('secret', '[REDACTED]'))

    expect(result).toMatchObject({ sampledBytes: 131_072, sampleCount: 3, truncated: false })
    expect(result.hotspots).toEqual([
      {
        functionName: 'buildRows',
        url: 'https://app.test/main.js?token=[REDACTED]',
        lineNumber: 10,
        columnNumber: 5,
        selfBytes: 98_304,
        selfPercent: 75,
        samples: 2
      },
      {
        functionName: 'save',
        url: 'https://app.test/main.js',
        lineNumber: 20,
        columnNumber: 3,
        selfBytes: 32_768,
        selfPercent: 25,
        samples: 1
      }
    ])
  })

  it('bounds output and normalizes unsafe function names', () => {
    const children = Array.from({ length: ALLOCATION_PROFILE_LIMITS.maxHotspots + 3 }, (_, index) => ({
      id: index + 2,
      callFrame: { functionName: index === 0 ? '\u0000\n' : `function-${index}`, url: `https://app.test/${index}.js` },
      selfSize: index === 0 ? 10_000 : index + 1
    }))
    const result = summarizeAllocationProfile({
      head: { id: 1, callFrame: { functionName: '(root)' }, selfSize: 0, children }
    })

    expect(result.hotspots).toHaveLength(ALLOCATION_PROFILE_LIMITS.maxHotspots)
    expect(result.hotspots.some((entry) => entry.functionName === '(anonymous)')).toBe(true)
    expect(result.truncated).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { CPU_PROFILE_LIMITS, summarizeCpuProfile } from '../src/shared/cpu-profile.js'

describe('CPU profile summary', () => {
  it('aggregates direct sample time by sanitized function location', () => {
    const result = summarizeCpuProfile({
      startTime: 1_000_000,
      endTime: 1_008_000,
      nodes: [
        { id: 1, callFrame: { functionName: 'render', url: 'https://app.test/main.js?token=secret', lineNumber: 9, columnNumber: 4 } },
        { id: 2, callFrame: { functionName: 'save', url: 'https://app.test/main.js', lineNumber: 19, columnNumber: 2 } }
      ],
      samples: [1, 2, 1],
      timeDeltas: [2_000, 1_000, 5_000]
    }, (url) => url.replace('secret', '[REDACTED]'))

    expect(result).toMatchObject({
      durationMs: 8,
      sampledTimeMs: 8,
      sampleCount: 3,
      truncated: false
    })
    expect(result.hotspots).toEqual([
      {
        functionName: 'render',
        url: 'https://app.test/main.js?token=[REDACTED]',
        lineNumber: 10,
        columnNumber: 5,
        selfTimeMs: 7,
        selfPercent: 87.5,
        samples: 2
      },
      {
        functionName: 'save',
        url: 'https://app.test/main.js',
        lineNumber: 20,
        columnNumber: 3,
        selfTimeMs: 1,
        selfPercent: 12.5,
        samples: 1
      }
    ])
  })

  it('bounds output and normalizes anonymous or unsafe function names', () => {
    const nodes = Array.from({ length: CPU_PROFILE_LIMITS.maxHotspots + 3 }, (_, index) => ({
      id: index + 1,
      callFrame: { functionName: index === 0 ? '\u0000\n' : `function-${index}`, url: `https://app.test/${index}.js` }
    }))
    const result = summarizeCpuProfile({
      startTime: 0,
      endTime: nodes.length * 1_000,
      nodes,
      samples: nodes.map((node) => node.id),
      timeDeltas: nodes.map(() => 1_000)
    })

    expect(result.hotspots).toHaveLength(CPU_PROFILE_LIMITS.maxHotspots)
    expect(result.hotspots.some((entry) => entry.functionName === '(anonymous)')).toBe(true)
    expect(result.truncated).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { coverageByteUsage, summarizeCoverageResources } from '../src/shared/code-coverage.js'

describe('code coverage accounting', () => {
  it('lets an unused nested function override an executed parent range', () => {
    expect(coverageByteUsage('0123456789', [
      { startOffset: 0, endOffset: 10, count: 1 },
      { startOffset: 2, endOffset: 5, count: 0 }
    ])).toEqual({ totalBytes: 10, usedBytes: 7 })
  })

  it('merges adjacent and nested used ranges without double counting UTF-8 bytes', () => {
    expect(coverageByteUsage('a🙂bc', [
      { startOffset: 0, endOffset: 1, count: 1 },
      { startOffset: 1, endOffset: 3, count: 1 },
      { startOffset: 3, endOffset: 4, count: 1 }
    ])).toEqual({ totalBytes: 7, usedBytes: 6 })
  })

  it('builds separate JavaScript and CSS totals', () => {
    expect(summarizeCoverageResources([
      { url: 'https://example.test/app.js', type: 'javascript', totalBytes: 100, usedBytes: 60, unusedBytes: 40, usedPercent: 60 },
      { url: 'https://example.test/app.css', type: 'css', totalBytes: 50, usedBytes: 10, unusedBytes: 40, usedPercent: 20 }
    ])).toEqual({
      totalBytes: 150,
      usedBytes: 70,
      unusedBytes: 80,
      usedPercent: 46.67,
      javascript: { resourceCount: 1, totalBytes: 100, usedBytes: 60, unusedBytes: 40 },
      css: { resourceCount: 1, totalBytes: 50, usedBytes: 10, unusedBytes: 40 }
    })
  })
})

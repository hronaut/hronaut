import { describe, expect, it } from 'vitest'
import { closedTabWaitResult } from '../src/main/mcp/server.js'

describe('closed tab wait outcome', () => {
  it('returns a stable stale-observation result when a tab closes before manager state removal', () => {
    const result = closedTabWaitResult(new Error('The tab closed while waiting for the page element.'))

    expect(result).toMatchObject({
      isError: true,
      structuredContent: { status: 'STALE_OBSERVATION', retrySafe: false }
    })
  })

  it('leaves ordinary wait errors to the normal error path', () => {
    expect(closedTabWaitResult(new Error('Timed out waiting for the page element.'))).toBeUndefined()
  })
})

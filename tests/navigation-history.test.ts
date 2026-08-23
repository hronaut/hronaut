import { describe, expect, it, vi } from 'vitest'
import { safeNavigationHistorySnapshot } from '../src/main/browser/navigation-history.js'

describe('safeNavigationHistorySnapshot', () => {
  it('returns an empty snapshot when Electron temporarily omits navigationHistory', () => {
    expect(safeNavigationHistorySnapshot({ isDestroyed: () => false })).toEqual({ entries: [], index: -1 })
  })

  it('does not inspect navigation history after the web contents is destroyed', () => {
    const getAllEntries = vi.fn()
    expect(safeNavigationHistorySnapshot({
      isDestroyed: () => true,
      navigationHistory: { getAllEntries, getActiveIndex: vi.fn() }
    })).toEqual({ entries: [], index: -1 })
    expect(getAllEntries).not.toHaveBeenCalled()
  })

  it('returns an empty snapshot when the web contents is destroyed while reading its history', () => {
    expect(safeNavigationHistorySnapshot({
      isDestroyed: () => false,
      navigationHistory: {
        getAllEntries: () => {
          throw new Error('Object has been destroyed')
        },
        getActiveIndex: vi.fn()
      }
    })).toEqual({ entries: [], index: -1 })
  })
})

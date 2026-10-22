import { describe, expect, it, vi } from 'vitest'
import { historyGesture } from '../src/main/browser/history-gesture/history-gesture.js'

// Back and Forward from the person's key or mouse button must not change a page the person's input does not reach.

function access(state: { shown?: boolean; destroyed?: boolean; occluded?: boolean; locked?: boolean; agentInput?: boolean; selecting?: boolean } = {}) {
  const tab = { id: 'shown', webContents: { id: 7, isDestroyed: () => state.destroyed === true } }
  return {
    shownTab: () => state.shown === false ? undefined : tab as never,
    browserContentOccluded: () => state.occluded === true,
    isHumanInteractionLocked: () => state.locked === true,
    agentInputWebContents: () => new Map(state.agentInput ? [[7, 1]] : []),
    nativeSelectionUnderWay: (id: number) => state.selecting === true && id === 7,
    go: vi.fn(async () => undefined)
  }
}

describe('going back or forward for the person\'s key or mouse button', () => {
  it('goes in the shown tab', async () => {
    const shown = access()
    await historyGesture(shown, 'back')
    await historyGesture(shown, 'forward')
    expect(shown.go.mock.calls).toEqual([['shown', 'back'], ['shown', 'forward']])
  })

  it('leaves the page alone behind a dialog, on a locked tab, during agent input, a pick or capture, and without a tab', async () => {
    for (const state of [{ occluded: true }, { locked: true }, { agentInput: true }, { selecting: true }, { shown: false }, { destroyed: true }]) {
      const refused = access(state)
      await historyGesture(refused, 'back')
      expect(refused.go, JSON.stringify(state)).not.toHaveBeenCalled()
    }
  })
})

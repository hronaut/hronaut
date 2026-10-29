import { describe, expect, it, vi } from 'vitest'
import type { Browser } from '../src/main/browser/browser.js'
import { historyGesture } from '../src/main/browser/history-gesture/history-gesture.js'

// Back and Forward from the person's key or mouse button must not change a page the person's input does not reach.

function browser(state: { shown?: boolean; destroyed?: boolean; occluded?: boolean; locked?: boolean; agentInput?: boolean; selecting?: boolean } = {}) {
  const tab = { id: 'shown', webContents: { id: 7, isDestroyed: () => state.destroyed === true } }
  const go = vi.fn(async (_tabId: string, _direction: 'back' | 'forward') => undefined)
  const fake = {
    activeTabId: state.shown === false ? undefined : tab.id,
    tabs: new Map([[tab.id, tab]]),
    browserContentOccluded: state.occluded === true,
    isHumanInteractionLocked: () => state.locked === true,
    agentInputWebContents: new Map(state.agentInput ? [[7, 1]] : []),
    screenshotAreaSessions: new Map(state.selecting ? [[7, {}]] : []),
    elementPickerSessions: new Map(),
    back: (tabId: string) => go(tabId, 'back'),
    forward: (tabId: string) => go(tabId, 'forward')
  }
  return Object.assign(fake as unknown as Browser, { go })
}

describe('going back or forward for the person\'s key or mouse button', () => {
  it('goes in the shown tab', async () => {
    const shown = browser()
    await historyGesture(shown, 'back')
    await historyGesture(shown, 'forward')
    expect(shown.go.mock.calls).toEqual([['shown', 'back'], ['shown', 'forward']])
  })

  it('leaves the page alone behind a dialog, on a locked tab, during agent input, a pick or capture, and without a tab', async () => {
    for (const state of [{ occluded: true }, { locked: true }, { agentInput: true }, { selecting: true }, { shown: false }, { destroyed: true }]) {
      const refused = browser(state)
      await historyGesture(refused, 'back')
      expect(refused.go, JSON.stringify(state)).not.toHaveBeenCalled()
    }
  })
})

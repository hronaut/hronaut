import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ screen: { getDisplayMatching: () => ({ id: 7 }) } }))
import { createWindowStatePersistence } from '../src/main/windows/window-state-persistence.js'

function persistence(fullScreen?: () => boolean) {
  const window = {
    isDestroyed: () => false,
    getNormalBounds: () => ({ x: 10, y: 20, width: 1200, height: 800 }),
    isMaximized: () => false,
    isFullScreen: () => true
  }
  return createWindowStatePersistence({
    window: () => window,
    ...(fullScreen ? { fullScreen } : {}),
    store: () => null,
    lastState: () => null,
    setLastState: () => undefined,
    logPrefix: '[test]'
  })
}

it('saves the window in full screen as it is, unless the host names the full screen to keep', () => {
  expect(persistence().currentState()).toEqual({
    bounds: { x: 10, y: 20, width: 1200, height: 800 },
    displayId: 7,
    maximized: false,
    fullScreen: true
  })
  // While a page holds full screen, such as a video, the next start opens the window as the person had it.
  expect(persistence(() => false).currentState()?.fullScreen).toBe(false)
})

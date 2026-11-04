import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ screen: { getDisplayMatching: () => ({ id: 7 }) } }))
import { createWindowStatePersistence } from '../src/main/windows/window-state-persistence.js'

function persistence(
  fullScreen?: () => boolean,
  stateUntilShown?: () => { maximized: boolean; fullScreen: boolean } | null,
  isVisible: () => boolean = () => false
) {
  const window = {
    isDestroyed: () => false,
    isVisible,
    getNormalBounds: () => ({ x: 10, y: 20, width: 1200, height: 800 }),
    isMaximized: () => false,
    isFullScreen: () => true
  }
  return createWindowStatePersistence({
    window: () => window,
    ...(fullScreen ? { fullScreen } : {}),
    ...(stateUntilShown ? { stateUntilShown } : {}),
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

// A window that started hidden in the tray, not yet maximized as it was saved, was saved again as not maximized.
it('saves the state a window that starts hidden takes when shown, while it stays hidden', () => {
  let untilShown: { maximized: boolean; fullScreen: boolean } | null = { maximized: true, fullScreen: false }
  let visible = false
  const saved = persistence(() => true, () => untilShown, () => visible)
  expect(saved.currentState()).toMatchObject({ maximized: true, fullScreen: false })
  // Shown without it, the window's own state is saved: what the person sees and changes.
  visible = true
  expect(saved.currentState()).toMatchObject({ maximized: false, fullScreen: true })
  visible = false
  untilShown = null
  expect(saved.currentState()).toMatchObject({ maximized: false, fullScreen: true })
})

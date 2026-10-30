import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp', isPackaged: true } }))
import type { Browser } from '../src/main/browser/browser.js'
import { watchCredentialSubmission } from '../src/main/browser/credential-capture/credential-capture.js'
import { attachPageKeyboardEvents } from '../src/main/browser/tab-events/page-keyboard-events.js'
import { attachPagePointerEvents } from '../src/main/browser/tab-events/page-pointer-events.js'

/** A browser that follows the person's clicks and keys on a page, with nothing else going on, and offers to save passwords. */
function personsBrowser(onCredentialSubmitted: () => void): Browser {
  return {
    browserContentOccluded: false,
    agentInputWebContents: new Map(),
    agentWheel: new Map(),
    screenshotAreaSessions: new Map(),
    elementPickerSessions: new Map(),
    authorizedAgentKeyboardInput: new Map(),
    shellHeldKeys: new Set(),
    isHumanInteractionLocked: () => false,
    splitViewContains: () => false,
    reproRecorder: { observeReproMouse: vi.fn(), observeReproKeyboard: vi.fn() },
    mcpActivityFollower: { noteHumanInput: vi.fn() },
    options: { onCredentialSubmitted }
  } as unknown as Browser
}

/** A website tab with a sign-in form the person clicks or types in, and sends whenever the test says. */
function signInPage(browser: Browser) {
  let send = (): void => undefined
  const webContents = Object.assign(new EventEmitter(), {
    id: 7,
    isDestroyed: () => false,
    executeJavaScriptInIsolatedWorld: vi.fn(() => new Promise((resolve) => {
      send = () => resolve({ origin: 'https://example.test', username: 'ada', password: 'correct horse' })
    }))
  })
  const tab = {
    id: 'tab-1', url: 'https://example.test/sign-in', webContents,
    humanInteractionGeneration: 0, lastActiveAt: performance.now(), lastHumanInteractionAt: Number.NEGATIVE_INFINITY
  }
  attachPagePointerEvents(browser, tab as never, webContents as never)
  attachPageKeyboardEvents(browser, tab as never, webContents as never)
  watchCredentialSubmission(browser, tab as never)
  return {
    press(input: 'mouse' | 'keyboard'): void {
      const event = { preventDefault: vi.fn() }
      if (input === 'mouse') webContents.emit('before-mouse-event', event, { type: 'mouseDown', button: 'left', x: 10, y: 10, clickCount: 1 })
      else {
        webContents.emit('before-input-event', event, {
          type: 'keyDown', key: 'a', code: 'KeyA', isAutoRepeat: false, isComposing: false,
          control: false, meta: false, alt: false, shift: false, location: 0, modifiers: []
        })
      }
      expect(event.preventDefault).not.toHaveBeenCalled()
    },
    async send(): Promise<void> {
      send()
      for (let turn = 0; turn < 5; turn += 1) await Promise.resolve()
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
})

it.each(['mouse', 'keyboard'] as const)(
  'offers to save a password sent within 15 seconds of the person\'s %s input on the page, whatever the wall clock does',
  async (input) => {
    const onCredentialSubmitted = vi.fn()
    const page = signInPage(personsBrowser(onCredentialSubmitted))
    page.press(input)
    vi.setSystemTime(Date.now() + 3_600_000)
    vi.advanceTimersByTime(15_000)
    await page.send()
    expect(onCredentialSubmitted).toHaveBeenCalledOnce()
    page.press(input)
    vi.setSystemTime(Date.now() - 3_600_000)
    vi.advanceTimersByTime(15_001)
    await page.send()
    expect(onCredentialSubmitted).toHaveBeenCalledOnce()
  }
)

import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECENTLY_AUDIBLE_MS, attachNavigationEvents } from '../src/main/browser/tab-events/navigation-events.js'

/** A stand-in for whatever the handlers call on the tab manager: any call or property gives another stand-in. */
function anything(): unknown {
  const stand: unknown = new Proxy(() => undefined, {
    get: (_target, key) => key === 'then' ? undefined : stand,
    apply: () => stand
  })
  return stand
}

/** A tab listening to its page, whose sound Chromium reports with audio-state-changed, as Electron does. */
function page() {
  let destroyed = false
  let muted = false
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => 'https://video.example/',
    isLoading: () => false,
    isLoadingMainFrame: () => false,
    isDestroyed: () => destroyed,
    isAudioMuted: () => muted
  })
  const tab = { id: 'tab', url: 'https://video.example/', audible: false, muted: false, sleeping: false, webContents: contents }
  const browser = new Proxy({}, { get: (_target, key) => key === 'destroyed' ? false : (anything() as Record<string | symbol, unknown>)[key] })
  attachNavigationEvents(browser as never, tab as never, contents as never)
  return {
    tab,
    sound: (audible: boolean) => contents.emit('audio-state-changed', { audible }),
    mute: () => { muted = true },
    destroy: () => {
      destroyed = true
      contents.emit('destroyed')
    }
  }
}

describe('a tab\'s sound', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows at once when the page starts playing', () => {
    const video = page()
    video.sound(true)
    expect(video.tab.audible).toBe(true)
  })

  it('still shows for 2 s after the sound stops, as in Chrome, then goes', () => {
    const video = page()
    video.sound(true)
    video.sound(false)
    expect(video.tab.audible).toBe(true)
    vi.advanceTimersByTime(RECENTLY_AUDIBLE_MS - 1)
    expect(video.tab.audible).toBe(true)
    vi.advanceTimersByTime(1)
    expect(video.tab.audible).toBe(false)
  })

  it('stays through a short pause in the sound', () => {
    const call = page()
    call.sound(true)
    call.sound(false)
    vi.advanceTimersByTime(RECENTLY_AUDIBLE_MS / 2)
    expect(call.tab.audible).toBe(true)
    call.sound(true)
    vi.advanceTimersByTime(RECENTLY_AUDIBLE_MS)
    expect(call.tab.audible).toBe(true)
    call.sound(false)
    vi.advanceTimersByTime(RECENTLY_AUDIBLE_MS)
    expect(call.tab.audible).toBe(false)
  })

  it('shows a mute at once, while the sound still shows', () => {
    const video = page()
    video.sound(true)
    video.mute()
    video.sound(false)
    expect(video.tab).toMatchObject({ audible: true, muted: true })
  })

  it('leaves nothing waiting once the page is gone', () => {
    const video = page()
    video.sound(true)
    video.sound(false)
    video.destroy()
    expect(vi.getTimerCount()).toBe(0)
  })
})

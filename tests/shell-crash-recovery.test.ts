import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import {
  reloadShellAfterRendererExit,
  SHELL_RELOAD_FIRST_DELAY_MS,
  SHELL_RELOAD_MAX_DELAY_MS,
  SHELL_RELOAD_STABLE_MS
} from '../src/main/windows/shell-crash-recovery.js'

// A crash of Hronaut's own window page left the window blank until the person quit.

function harness() {
  const contents = Object.assign(new EventEmitter(), { reload: vi.fn(), isDestroyed: () => false })
  const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: vi.fn(() => false) })
  let quitting = false
  reloadShellAfterRendererExit(window as unknown as BrowserWindow, () => quitting)
  const exit = (reason = 'crashed') => contents.emit('render-process-gone', {}, { reason, exitCode: 1 })
  const loaded = () => contents.emit('did-finish-load')
  return { window, contents, exit, loaded, quit: () => { quitting = true } }
}

describe('the main window\'s page after its process exits', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('is loaded again, once, after a short wait', () => {
    const { contents, exit } = harness()
    exit()
    vi.advanceTimersByTime(SHELL_RELOAD_FIRST_DELAY_MS - 1)
    expect(contents.reload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(contents.reload).toHaveBeenCalledOnce()
  })

  it('waits twice as long each time it exits again soon after, up to a limit, and from the start once it stayed up', () => {
    const { contents, exit, loaded } = harness()
    let expected = SHELL_RELOAD_FIRST_DELAY_MS
    for (let crash = 0; crash < 10; crash++) {
      exit()
      vi.advanceTimersByTime(expected - 1)
      expect(contents.reload).toHaveBeenCalledTimes(crash)
      vi.advanceTimersByTime(1)
      expect(contents.reload).toHaveBeenCalledTimes(crash + 1)
      loaded()
      expected = Math.min(expected * 2, SHELL_RELOAD_MAX_DELAY_MS)
    }
    expect(expected).toBe(SHELL_RELOAD_MAX_DELAY_MS)
    vi.advanceTimersByTime(SHELL_RELOAD_STABLE_MS)
    exit()
    vi.advanceTimersByTime(SHELL_RELOAD_FIRST_DELAY_MS)
    expect(contents.reload).toHaveBeenCalledTimes(11)
  })

  it('is not loaded again after a clean exit, while Hronaut quits, or once the window closed', () => {
    const clean = harness()
    clean.exit('clean-exit')
    vi.advanceTimersByTime(SHELL_RELOAD_MAX_DELAY_MS)
    expect(clean.contents.reload).not.toHaveBeenCalled()

    const quitting = harness()
    quitting.exit()
    quitting.quit()
    vi.advanceTimersByTime(SHELL_RELOAD_MAX_DELAY_MS)
    expect(quitting.contents.reload).not.toHaveBeenCalled()

    const closed = harness()
    closed.exit()
    closed.window.emit('closed')
    vi.advanceTimersByTime(SHELL_RELOAD_MAX_DELAY_MS)
    expect(closed.contents.reload).not.toHaveBeenCalled()
  })
})

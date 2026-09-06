import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { bindTrayActivation } from '../src/main/tray-activation.js'

describe('tray activation', () => {
  it.each(['linux', 'win32', 'darwin'] as const)('preserves native activation behavior on %s', platform => {
    const tray = Object.assign(new EventEmitter(), { popUpContextMenu: vi.fn() })
    const showWindow = vi.fn()
    bindTrayActivation(tray, showWindow, platform)
    tray.emit('click')
    expect(showWindow).toHaveBeenCalledTimes(platform === 'linux' ? 1 : 0)
    expect(tray.popUpContextMenu).toHaveBeenCalledTimes(platform === 'linux' ? 0 : 1)
    tray.emit('right-click')
    expect(tray.popUpContextMenu).toHaveBeenCalledTimes(platform === 'linux' ? 1 : 2)
    expect(showWindow).toHaveBeenCalledTimes(platform === 'linux' ? 1 : 0)
    tray.emit('double-click')
    expect(showWindow).toHaveBeenCalledTimes(1)
    expect(tray.popUpContextMenu).toHaveBeenCalledTimes(platform === 'linux' ? 1 : 2)
  })
})

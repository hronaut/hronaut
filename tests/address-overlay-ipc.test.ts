import { describe, expect, it, vi } from 'vitest'
import type { IpcMainEvent } from 'electron'
import { registerAddressOverlayIpc } from '../src/main/address-overlay-ipc.js'

// A middle-click on a row of the suggestions view now opens it in a new tab behind, and gives the address field the
// keyboard back afterwards.

function registered() {
  const handlers = new Map<string, (event: IpcMainEvent, value?: unknown) => void>()
  const overlay = { assertAddressOverlaySender: vi.fn(), show: vi.fn(), hide: vi.fn(), measured: vi.fn(), select: vi.fn(), returnFocus: vi.fn() }
  const assertMainShellSender = vi.fn()
  registerAddressOverlayIpc({ on: (channel: string, handler: (event: IpcMainEvent, value?: unknown) => void) => { handlers.set(channel, handler) } } as never, {
    assertMainShellSender,
    workspaceStartupFailure: () => undefined,
    addressOverlay: () => overlay as never
  })
  const select = (value: unknown) => handlers.get('address-overlay:select')!({ sender: {} } as IpcMainEvent, value)
  const returnFocus = () => handlers.get('address-overlay:return-focus')!({ sender: {} } as IpcMainEvent)
  return { overlay, assertMainShellSender, select, returnFocus }
}

describe('a pick from the address suggestions view', () => {
  it('passes on a pick for a tab behind, and only the fields the shell knows', () => {
    const { overlay, select } = registered()
    select({ sessionId: 2, suggestionId: 'history:docs' })
    select({ sessionId: 2, suggestionId: 'history:docs', disposition: 'new-background-tab', url: 'https://elsewhere.example/' })
    expect(overlay.select.mock.calls).toEqual([
      [{ sessionId: 2, suggestionId: 'history:docs' }],
      [{ sessionId: 2, suggestionId: 'history:docs', disposition: 'new-background-tab' }]
    ])
    expect(overlay.assertAddressOverlaySender).toHaveBeenCalledTimes(2)
  })

  it('refuses a pick with anything else for where it opens', () => {
    const { overlay, select } = registered()
    for (const disposition of ['new-tab', 'new-window', 'current-tab', '', 1, null, { background: true }]) {
      expect(() => select({ sessionId: 2, suggestionId: 'history:docs', disposition }), String(disposition)).toThrow('Invalid address suggestion selection')
    }
    expect(() => select({ sessionId: 0, suggestionId: 'history:docs' })).toThrow('Invalid address suggestion selection')
    expect(overlay.select).not.toHaveBeenCalled()
  })

  it('takes the keyboard back for the address field only when the main shell asks', () => {
    const { overlay, assertMainShellSender, returnFocus } = registered()
    returnFocus()
    expect(assertMainShellSender).toHaveBeenCalledOnce()
    expect(overlay.returnFocus).toHaveBeenCalledOnce()
    assertMainShellSender.mockImplementation(() => { throw new Error('Untrusted sender') })
    expect(() => returnFocus()).toThrow('Untrusted sender')
    expect(overlay.returnFocus).toHaveBeenCalledOnce()
  })
})

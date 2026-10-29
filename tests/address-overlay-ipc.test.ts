import { describe, expect, it, vi } from 'vitest'
import type { IpcMainEvent } from 'electron'
import { registerAddressOverlayIpc } from '../src/main/overlays/address-overlay-ipc.js'

// A middle-click on a row of the suggestions view now opens it in a new tab behind, and gives the address field the
// keyboard back afterwards.

function registered() {
  const handlers = new Map<string, (event: IpcMainEvent, value?: unknown) => void>()
  const overlay = { isAddressOverlaySender: vi.fn(() => true), show: vi.fn(), hide: vi.fn(), measured: vi.fn(), select: vi.fn(), returnFocus: vi.fn() }
  const assertMainShellSender = vi.fn()
  registerAddressOverlayIpc({ on: (channel: string, handler: (event: IpcMainEvent, value?: unknown) => void) => { handlers.set(channel, handler) } } as never, {
    assertMainShellSender,
    workspaceStartupFailure: () => undefined,
    addressOverlay: () => overlay as never
  })
  const select = (value: unknown) => handlers.get('address-overlay:select')!({ sender: {} } as IpcMainEvent, value)
  const measured = (value: unknown) => handlers.get('address-overlay:measured')!({ sender: {} } as IpcMainEvent, value)
  const returnFocus = () => handlers.get('address-overlay:return-focus')!({ sender: {} } as IpcMainEvent)
  const show = (value: unknown) => handlers.get('address-overlay:show')!({ sender: {} } as IpcMainEvent, value)
  return { overlay, assertMainShellSender, select, measured, returnFocus, show }
}

function request(suggestions: unknown[], selectedIndex = -1, selectedAction?: unknown) {
  return {
    sessionId: 3,
    bounds: { x: 1, y: 1, width: 400, maxHeight: 300 },
    suggestions,
    selectedIndex,
    ...(selectedAction === undefined ? {} : { selectedAction }),
    theme: 'dark',
    locale: 'en-US'
  }
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
    expect(overlay.isAddressOverlaySender).toHaveBeenCalledTimes(2)
  })

  // The view's last pick could arrive after the window closed it, when a throw would be an uncaught exception in main.
  it('drops a pick or a measurement from anything but the current suggestions view', () => {
    const { overlay, select, measured } = registered()
    overlay.isAddressOverlaySender.mockReturnValue(false)
    select({ sessionId: 2, suggestionId: 'history:docs' })
    measured({ sessionId: 2, height: 120 })
    expect(overlay.select).not.toHaveBeenCalled()
    expect(overlay.measured).not.toHaveBeenCalled()
    overlay.isAddressOverlaySender.mockReturnValue(true)
    measured({ sessionId: 2, height: 120 })
    expect(overlay.measured).toHaveBeenCalledOnce()
  })

  it('refuses a pick with anything else for where it opens', () => {
    const { overlay, select } = registered()
    for (const disposition of ['new-tab', 'new-window', 'current-tab', '', 1, null, { background: true }]) {
      expect(() => select({ sessionId: 2, suggestionId: 'history:docs', disposition }), String(disposition)).toThrow('Invalid address suggestion selection')
    }
    expect(() => select({ sessionId: 0, suggestionId: 'history:docs' })).toThrow('Invalid address suggestion selection')
    expect(overlay.select).not.toHaveBeenCalled()
  })

  it('passes on Switch to this tab, and refuses it with anything for where the row opens', () => {
    const { overlay, select } = registered()
    select({ sessionId: 2, suggestionId: 'history:docs', action: 'switch-tab', tabId: 'other' })
    expect(overlay.select.mock.calls).toEqual([[{ sessionId: 2, suggestionId: 'history:docs', action: 'switch-tab' }]])
    for (const value of [
      { sessionId: 2, suggestionId: 'history:docs', action: 'switch-tab', disposition: 'new-background-tab' },
      { sessionId: 2, suggestionId: 'history:docs', action: 'close-tab' },
      { sessionId: 2, suggestionId: 'history:docs', action: true }
    ]) expect(() => select(value), JSON.stringify(value)).toThrow('Invalid address suggestion selection')
    expect(overlay.select).toHaveBeenCalledOnce()
  })

  it('shows open tabs\' rows and Switch to this tab only for a row with a tab to go to', () => {
    const { overlay, show } = registered()
    const visit = { id: 'history:docs', kind: 'history', title: 'Docs', url: 'https://docs.example/', openTabId: 'tab-2' }
    const tab = { id: 'tab:tab-3', kind: 'tab', title: 'Docs', url: 'https://docs.example/', openTabId: 'tab-3' }
    const plain = { id: 'bookmark:docs', kind: 'bookmark', title: 'Docs', url: 'https://docs.example/' }
    show(request([visit, tab, plain], 0, 'switch-tab'))
    show(request([tab], 0))
    expect(overlay.show).toHaveBeenCalledTimes(2)
    for (const [value, error] of [
      // An open tab's row names its tab.
      [request([{ ...tab, openTabId: undefined }]), 'Invalid address overlay suggestions'],
      [request([{ ...visit, openTabId: '' }]), 'Invalid address overlay suggestions'],
      [request([{ ...visit, openTabId: 'x'.repeat(513) }]), 'Invalid address overlay suggestions'],
      [request([{ ...visit, kind: 'window' }]), 'Invalid address overlay suggestions'],
      // Tab goes on only to a highlighted bookmark or visit open in another tab.
      [request([visit, tab, plain], 1, 'switch-tab'), 'Invalid address overlay selection'],
      [request([visit, tab, plain], 2, 'switch-tab'), 'Invalid address overlay selection'],
      [request([visit, tab, plain], -1, 'switch-tab'), 'Invalid address overlay selection'],
      [request([visit], 0, 'open'), 'Invalid address overlay selection']
    ] as const) expect(() => show(value), JSON.stringify(value)).toThrow(error)
    expect(overlay.show).toHaveBeenCalledTimes(2)
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

import { describe, expect, it, vi } from 'vitest'
import type { IpcMainEvent } from 'electron'
import { registerAddressOverlayIpc } from '../src/main/address-overlay-ipc.js'

// A pick in the suggestions view now says whether it opens in a new tab, for a middle-click or Ctrl+click on its row.

function registered() {
  const handlers = new Map<string, (event: IpcMainEvent, value?: unknown) => void>()
  const overlay = { assertAddressOverlaySender: vi.fn(), show: vi.fn(), hide: vi.fn(), measured: vi.fn(), select: vi.fn() }
  registerAddressOverlayIpc({ on: (channel: string, handler: (event: IpcMainEvent, value?: unknown) => void) => { handlers.set(channel, handler) } } as never, {
    assertMainShellSender: vi.fn(),
    workspaceStartupFailure: () => undefined,
    addressOverlay: () => overlay as never
  })
  const select = (value: unknown) => handlers.get('address-overlay:select')!({ sender: {} } as IpcMainEvent, value)
  return { overlay, select }
}

describe('a pick from the address suggestions view', () => {
  it('passes on where the row opens, and only the fields the shell knows', () => {
    const { overlay, select } = registered()
    select({ sessionId: 2, suggestionId: 'history:docs' })
    select({ sessionId: 2, suggestionId: 'history:docs', disposition: 'new-background-tab' })
    select({ sessionId: 2, suggestionId: 'history:docs', disposition: 'new-tab', url: 'https://elsewhere.example/' })
    expect(overlay.select.mock.calls).toEqual([
      [{ sessionId: 2, suggestionId: 'history:docs' }],
      [{ sessionId: 2, suggestionId: 'history:docs', disposition: 'new-background-tab' }],
      [{ sessionId: 2, suggestionId: 'history:docs', disposition: 'new-tab' }]
    ])
    expect(overlay.assertAddressOverlaySender).toHaveBeenCalledTimes(3)
  })

  it('refuses a pick with anything else for where it opens', () => {
    const { overlay, select } = registered()
    for (const disposition of ['new-window', 'current-tab', '', 1, null, { background: true }]) {
      expect(() => select({ sessionId: 2, suggestionId: 'history:docs', disposition }), String(disposition)).toThrow('Invalid address suggestion selection')
    }
    expect(() => select({ sessionId: 0, suggestionId: 'history:docs' })).toThrow('Invalid address suggestion selection')
    expect(overlay.select).not.toHaveBeenCalled()
  })
})

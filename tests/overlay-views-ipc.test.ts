import type { IpcMainEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { registerOverlayViewsIpc } from '../src/main/overlay-views-ipc.js'

// Closing the window closes the overlay views, and a view's last report could still arrive afterwards: its sender
// check threw, an uncaught exception in main. Each report now counts only from the view that draws now, and one from
// anything else, the shell or a page, has no effect and throws nothing.

describe('overlay views\' reports', () => {
  function registered() {
    const handlers = new Map<string, (event: IpcMainEvent, value?: unknown) => void>()
    const views = {
      agentCard: { webContents: { getZoomFactor: () => 1 } },
      toast: { webContents: { getZoomFactor: () => 1 } },
      tooltip: { webContents: { getZoomFactor: () => 1 } },
      sidebar: { webContents: { getZoomFactor: () => 1 } },
      statusBubble: { webContents: { getZoomFactor: () => 1 } }
    }
    const fromView = (view: { webContents: object }) => ({ isSender: (event: Pick<IpcMainEvent, 'sender'>) => event.sender === view.webContents })
    const agentCards = { refused: vi.fn(), show: vi.fn(), hide: vi.fn(), measured: vi.fn(), received: vi.fn() }
    const toastOverlay = { refused: vi.fn(), show: vi.fn(), measured: vi.fn(), received: vi.fn() }
    const shellTooltips = { show: vi.fn(), hide: vi.fn(), measured: vi.fn(), shownId: undefined }
    const sidebarOverlay = { refused: vi.fn(), show: vi.fn(), hide: vi.fn(), rendered: vi.fn(), pointer: vi.fn(), received: vi.fn(), tooltip: vi.fn((request: unknown) => request) }
    const statusBubble = { measured: vi.fn() }
    registerOverlayViewsIpc({ on: (channel: string, handler: (event: IpcMainEvent, value?: unknown) => void) => { handlers.set(channel, handler) } } as never, {
      assertMainShellSender: vi.fn(),
      workspaceStartupFailure: () => undefined,
      shellTooltips: () => shellTooltips as never,
      agentCards: () => agentCards as never,
      toastOverlay: () => toastOverlay as never,
      agentCardView: () => fromView(views.agentCard),
      toastOverlayView: () => fromView(views.toast),
      tooltipView: () => fromView(views.tooltip),
      sidebarOverlay: () => sidebarOverlay as never,
      sidebarOverlayView: () => fromView(views.sidebar),
      statusBubble: () => statusBubble as never,
      statusBubbleView: () => fromView(views.statusBubble)
    })
    const reports = [
      { channel: 'agent-card-view:measured', view: views.agentCard, value: { cardId: 1, revision: 1, width: 320, height: 120 }, effect: agentCards.measured },
      { channel: 'agent-card-view:message', view: views.agentCard, value: { cardId: 1, kind: 'action', action: 'pause' }, effect: agentCards.received },
      { channel: 'toast-overlay-view:measured', view: views.toast, value: { revision: 1, height: 40 }, effect: toastOverlay.measured },
      { channel: 'toast-overlay-view:message', view: views.toast, value: { id: 1, kind: 'dismiss' }, effect: toastOverlay.received },
      { channel: 'tooltip-overlay:measured', view: views.tooltip, value: { id: 1, width: 80, height: 24 }, effect: shellTooltips.measured },
      { channel: 'status-bubble:measured', view: views.statusBubble, value: { id: 1, width: 140, height: 22, shortened: false }, effect: statusBubble.measured },
      { channel: 'sidebar-overlay-view:rendered', view: views.sidebar, value: { revision: 1 }, effect: sidebarOverlay.rendered },
      { channel: 'sidebar-overlay-view:pointer', view: views.sidebar, value: { hovered: true, held: false }, effect: sidebarOverlay.pointer },
      { channel: 'sidebar-overlay-view:intent', view: views.sidebar, value: { kind: 'open-home' }, effect: sidebarOverlay.received },
      {
        channel: 'sidebar-overlay-view:tooltip-show',
        view: views.sidebar,
        value: { id: 1, text: 'Home', anchor: { x: 0, y: 0, width: 32, height: 32 }, placement: 'right', theme: 'dark' },
        effect: shellTooltips.show
      },
      { channel: 'sidebar-overlay-view:tooltip-hide', view: views.sidebar, value: 1, effect: shellTooltips.hide }
    ]
    const send = (channel: string, sender: object, value: unknown) => handlers.get(channel)!({ sender } as IpcMainEvent, value)
    return { handlers, reports, send }
  }

  it('take effect from the view that draws them', () => {
    const { reports, send } = registered()
    for (const { channel, view, value, effect } of reports) {
      send(channel, view.webContents, value)
      expect(effect, channel).toHaveBeenCalledOnce()
    }
  })

  it('from anything else, the shell, a page or a view the window closed, have no effect and throw nothing', () => {
    const { handlers, reports, send } = registered()
    // Every report channel the module listens on is covered here.
    expect([...handlers.keys()].filter((channel) => channel.includes('-view:') || channel.endsWith(':measured')).sort())
      .toEqual(reports.map(({ channel }) => channel).sort())
    const shell = { getZoomFactor: () => 1 }
    const page = { getZoomFactor: () => 1 }
    const closedView = { getZoomFactor: () => 1 }
    for (const { channel, value, effect } of reports) {
      for (const sender of [shell, page, closedView]) {
        expect(() => send(channel, sender, value), channel).not.toThrow()
      }
      expect(effect, channel).not.toHaveBeenCalled()
    }
  })
})

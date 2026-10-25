import { EventEmitter } from 'node:events'
import type { IpcMainEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp', isPackaged: true } }))
const { BrowserTabsManager } = await import('../src/main/browser/tabs-manager.js')
const { registerOverlayViewsIpc } = await import('../src/main/overlay-views-ipc.js')
const { createOverlaySurfaces } = await import('../src/main/windows/overlay-surfaces.js')

// Pointing at a link showed nothing of where it goes. Chrome shows its address at the bottom corner of the page in
// view; the bubble's view reports only its size, and only the page in view gets one.

describe('the status bubble view\'s reports', () => {
  it('are taken only from the bubble\'s own view, and only when well formed', () => {
    const handlers = new Map<string, (event: IpcMainEvent, value?: unknown) => void>()
    const bubble = { measured: vi.fn() }
    const view = { webContents: {} }
    registerOverlayViewsIpc({ on: (channel: string, handler: (event: IpcMainEvent, value?: unknown) => void) => { handlers.set(channel, handler) } } as never, {
      assertMainShellSender: vi.fn(),
      workspaceStartupFailure: () => undefined,
      shellTooltips: () => ({}) as never,
      agentCards: () => ({}) as never,
      toastOverlay: () => ({}) as never,
      agentCardView: () => ({ isSender: () => false }),
      toastOverlayView: () => ({ isSender: () => false }),
      tooltipView: () => ({ isSender: () => false }),
      sidebarOverlay: () => ({}) as never,
      sidebarOverlayView: () => ({ isSender: () => false }),
      statusBubble: () => bubble,
      statusBubbleView: () => ({ isSender: (event: Pick<IpcMainEvent, 'sender'>) => event.sender === view.webContents })
    })
    const send = (event: unknown, value: unknown) => handlers.get('status-bubble:measured')!(event as IpcMainEvent, value)
    const measurement = { id: 2, width: 140, height: 22, shortened: false }
    expect(() => send({ sender: {} }, measurement)).toThrow('Rejected IPC from a non-status-bubble renderer')
    expect(bubble.measured).not.toHaveBeenCalled()
    send({ sender: view.webContents }, { ...measurement, width: -1 })
    expect(bubble.measured).not.toHaveBeenCalled()
    send({ sender: view.webContents }, { ...measurement, extra: 'ignored' })
    expect(bubble.measured).toHaveBeenCalledExactlyOnceWith(measurement)
  })
})

describe('the status bubble\'s view', () => {
  it('keeps the pointer from its page, moves out of its way, and gives back the keyboard a click there took', async () => {
    const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: vi.fn(), setZoomFactor: vi.fn() })
    const view = { setBounds: vi.fn() }
    const bubble = { pointerOnBubble: vi.fn(), viewFocused: vi.fn() }
    const bubbleView = { ensure: vi.fn(async () => ({ view, webContents: contents }) as never), present: vi.fn(), withdraw: vi.fn() }
    const surfaces = createOverlaySurfaces({
      trustedShellUrl: () => 'file:///app/index.html',
      agentCardView: {} as never,
      agentCards: {} as never,
      toastOverlayView: {} as never,
      toastOverlay: {} as never,
      tooltipView: {} as never,
      sidebarOverlayView: {} as never,
      sidebarOverlay: {} as never,
      sidebarOverlayKeyboard: {} as never,
      shellTooltips: {} as never,
      statusBubbleView: bubbleView,
      statusBubble: bubble
    })
    const surface = await surfaces.ensureStatusBubbleSurface()
    // The view is loaded once and reused; its listeners are attached once.
    await surfaces.ensureStatusBubbleSurface()
    const state = { id: 1, text: { scheme: 'https://', host: 'example.com', rest: '/' }, theme: 'dark', side: 'left', maxWidth: 300, corner: 12, opening: true } as const
    surface.send(state)
    expect(contents.send).toHaveBeenCalledWith('status-bubble:state', state)
    surface.setBounds({ x: 1, y: 2, width: 3, height: 4 })
    surface.present()
    expect(view.setBounds).toHaveBeenCalledWith({ x: 1, y: 2, width: 3, height: 4 })
    expect(bubbleView.present).toHaveBeenCalledOnce()

    const event = { preventDefault: vi.fn() }
    contents.emit('before-mouse-event', event, { type: 'mouseMove', x: 5, y: 6 })
    contents.emit('before-mouse-event', event, { type: 'mouseDown', x: 5, y: 6 })
    contents.emit('before-mouse-event', event, { type: 'mouseLeave', x: 0, y: 0 })
    expect(event.preventDefault).toHaveBeenCalledTimes(3)
    expect(bubble.pointerOnBubble.mock.calls).toEqual([[5, 6], [5, 6]])
    contents.emit('focus')
    expect(bubble.viewFocused).toHaveBeenCalledOnce()
  })
})

describe('where the status bubble shows', () => {
  function fixture() {
    const view = (bounds = { x: 280, y: 60, width: 1150, height: 830 }) => ({ visible: true, bounds, getVisible() { return this.visible }, getBounds() { return this.bounds } })
    const first = { id: 'first', view: view(), webContents: { isDestroyed: () => false } }
    const second = { id: 'second', view: view({ x: 860, y: 60, width: 570, height: 830 }), webContents: { isDestroyed: () => false } }
    const third = { id: 'third', view: view(), webContents: { isDestroyed: () => false } }
    const children: unknown[] = [first.view, second.view, third.view]
    const pageCornerRadii = new WeakMap<object, number>([[first.view, 12]])
    const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
      destroyed: false,
      window: { contentView: { children } },
      tabs: new Map([[first.id, first], [second.id, second], [third.id, third]]),
      activeTabId: first.id,
      splitView: null as unknown,
      browserContentOccluded: false,
      pageCornerRadii
    }) as unknown as Pick<InstanceType<typeof BrowserTabsManager>, 'statusBubblePane'> & { splitView: unknown; browserContentOccluded: boolean; destroyed: boolean }
    return { manager, first, second, third, children }
  }

  it('is the page in view, or either split pane, at its bounds and with its corner', () => {
    const { manager, first, second } = fixture()
    expect(manager.statusBubblePane('first')).toEqual({ bounds: first.view.bounds, corner: 12 })
    expect(manager.statusBubblePane('second')).toBeNull()
    manager.splitView = { firstTabId: 'first', secondTabId: 'second', orientation: 'vertical', ratio: 0.5 }
    expect(manager.statusBubblePane('second')).toEqual({ bounds: second.view.bounds, corner: 0 })
    expect(manager.statusBubblePane('third')).toBeNull()
    expect(manager.statusBubblePane('missing')).toBeNull()
  })

  it('is none while trusted chrome covers the pages, or the page is hidden, out of the window, empty or gone', () => {
    const covered = fixture()
    covered.manager.browserContentOccluded = true
    expect(covered.manager.statusBubblePane('first')).toBeNull()
    const hidden = fixture()
    hidden.first.view.visible = false
    expect(hidden.manager.statusBubblePane('first')).toBeNull()
    const detached = fixture()
    detached.children.splice(0, 1)
    expect(detached.manager.statusBubblePane('first')).toBeNull()
    const empty = fixture()
    empty.first.view.bounds = { x: 280, y: 60, width: 0, height: 830 }
    expect(empty.manager.statusBubblePane('first')).toBeNull()
    const crashed = fixture()
    crashed.first.webContents.isDestroyed = () => true
    expect(crashed.manager.statusBubblePane('first')).toBeNull()
    const closing = fixture()
    closing.manager.destroyed = true
    expect(closing.manager.statusBubblePane('first')).toBeNull()
  })
})

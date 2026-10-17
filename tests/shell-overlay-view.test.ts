import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const created: FakeView[] = []

class FakeWebContents extends EventEmitter {
  destroyed = false
  loadURL = vi.fn(async (_url: string) => undefined)
  setWindowOpenHandler = vi.fn()
  isDestroyed = () => this.destroyed
  close = vi.fn(() => {
    this.destroyed = true
    this.emit('destroyed')
  })
}

class FakeView {
  readonly webContents = new FakeWebContents()
  visible = true
  background?: string
  constructor(readonly options: unknown) {
    created.push(this)
  }

  setBackgroundColor(color: string): void { this.background = color }
  setVisible(visible: boolean): void { this.visible = visible }
}

vi.mock('electron', () => ({ WebContentsView: FakeView }))

const { ShellOverlayView } = await import('../src/main/shell-overlay-view.js')

function fakeWindow() {
  const children: unknown[] = []
  return {
    destroyed: false,
    isDestroyed() { return this.destroyed },
    contentView: {
      children,
      // Like Electron: a view already there moves to the top, whatever index it is given.
      addChildView: vi.fn((view: unknown, at?: number) => {
        const index = children.indexOf(view)
        if (index >= 0) children.splice(index, 1)
        if (index < 0 && at !== undefined) children.splice(at, 0, view)
        else children.push(view)
      }),
      removeChildView: vi.fn((view: unknown) => { children.splice(children.indexOf(view), 1) })
    }
  }
}

function overlay(window = fakeWindow(), keepAbove?: () => readonly unknown[]) {
  const onLost = vi.fn()
  const view = new ShellOverlayView({
    name: 'card',
    preload: '/app/preload/card.cjs',
    url: () => 'file:///app/renderer/card.html',
    window: () => window as never,
    urlMatches: (actual, expected) => actual === expected,
    onLost,
    ...(keepAbove ? { keepAbove } : {})
  })
  return { view, window, onLost }
}

describe('shell overlay view', () => {
  beforeEach(() => { created.length = 0 })

  it('loads one sandboxed, transparent view from its trusted page, once', async () => {
    const { view } = overlay()
    const [first, second] = await Promise.all([view.ensure(), view.ensure()])
    expect(first).toBe(second)
    expect(created).toHaveLength(1)
    const [fake] = created
    expect(fake?.options).toEqual({ webPreferences: { preload: '/app/preload/card.cjs', contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } })
    expect(fake?.background).toBe('#00000000')
    expect(fake?.visible).toBe(false)
    expect(fake?.webContents.loadURL).toHaveBeenCalledWith('file:///app/renderer/card.html')
    // Popups are denied and navigation away from the trusted page is refused.
    expect(fake?.webContents.setWindowOpenHandler.mock.calls[0]?.[0]()).toEqual({ action: 'deny' })
    const away = { preventDefault: vi.fn() }
    fake?.webContents.emit('will-navigate', away, 'https://example.com/')
    expect(away.preventDefault).toHaveBeenCalled()
  })

  it('accepts IPC only from its own view on its trusted page', async () => {
    const { view } = overlay()
    expect(view.isSender({ sender: {} as never, senderFrame: { url: 'file:///app/renderer/card.html' } })).toBe(false)
    const { webContents } = await view.ensure()
    expect(view.isSender({ sender: webContents, senderFrame: { url: 'file:///app/renderer/card.html' } })).toBe(true)
    expect(view.isSender({ sender: webContents, senderFrame: { url: 'https://example.com/' } })).toBe(false)
    expect(view.isSender({ sender: webContents, senderFrame: null })).toBe(false)
    expect(view.isSender({ sender: new FakeWebContents() as never, senderFrame: { url: 'file:///app/renderer/card.html' } })).toBe(false)
  })

  it('presents on top of the window and leaves it when withdrawn', async () => {
    const { view, window } = overlay()
    const { view: native } = await view.ensure()
    window.contentView.children.push('page')
    view.present()
    expect(window.contentView.children).toEqual(['page', native])
    // A page attached meanwhile goes under it again on the next present.
    window.contentView.children.push('another page')
    view.present()
    expect(window.contentView.children.at(-1)).toBe(native)
    expect((native as unknown as FakeView).visible).toBe(true)
    // Already on top, it is not added again: that would take keyboard focus from it.
    window.contentView.addChildView.mockClear()
    view.present()
    expect(window.contentView.addChildView).not.toHaveBeenCalled()
    view.withdraw()
    expect(window.contentView.children).toEqual(['page', 'another page'])
    expect((native as unknown as FakeView).visible).toBe(false)
  })

  it('stays under the overlays it keeps above it, and leaves them where they are', async () => {
    const above: unknown[] = ['card', 'tooltip']
    const { view, window } = overlay(fakeWindow(), () => above)
    const { view: native } = await view.ensure()
    const { children } = window.contentView
    children.push('page', 'card')
    view.present()
    expect(children).toEqual(['page', native, 'card'])
    // Restacked while only those overlays are above it: nothing moves, so neither loses keyboard focus.
    children.push('tooltip')
    window.contentView.addChildView.mockClear()
    view.present()
    expect(window.contentView.addChildView).not.toHaveBeenCalled()
    expect(window.contentView.removeChildView).not.toHaveBeenCalled()
    // A page attached on top: the view goes above it, still under the overlays.
    children.splice(1, 0, 'other page')
    children.push('new page')
    view.present()
    expect(children).toEqual(['page', 'other page', 'card', 'tooltip', 'new page', native])
    // The card's own restack puts it back on top, and the next restack of this view leaves it there.
    window.contentView.addChildView('card')
    window.contentView.addChildView.mockClear()
    view.present()
    expect(children).toEqual(['page', 'other page', 'tooltip', 'new page', native, 'card'])
    expect(window.contentView.addChildView).not.toHaveBeenCalled()
  })

  it('reports a renderer that went away and loads a new view next time', async () => {
    const { view, window, onLost } = overlay()
    const first = await view.ensure()
    view.present()
    first.webContents.emit('render-process-gone')
    expect(onLost).toHaveBeenCalledOnce()
    expect(window.contentView.children).toEqual([])
    expect(view.isSender({ sender: first.webContents, senderFrame: { url: 'file:///app/renderer/card.html' } })).toBe(false)
    const second = await view.ensure()
    expect(second).not.toBe(first)
  })

  it('closes quietly, and fails a load when the window closed meanwhile', async () => {
    const { view, onLost } = overlay()
    const loaded = await view.ensure()
    view.close()
    expect(loaded.webContents.isDestroyed()).toBe(true)
    expect(onLost).not.toHaveBeenCalled()

    const window = fakeWindow()
    const closing = overlay(window)
    const loading = closing.view.ensure()
    window.destroyed = true
    await expect(loading).rejects.toThrow('The main window closed before the card view loaded')
    expect(created.at(-1)?.webContents.isDestroyed()).toBe(true)
    window.destroyed = false
    await expect(closing.view.ensure()).resolves.toBeTruthy()
  })
})

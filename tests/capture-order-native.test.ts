import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { CaptureDiagnosticGlobal } from '../src/main/capture-order-diagnostic.js'
async function setup(enabled = true) {
  vi.resetModules()
  vi.stubEnv('HRONAUT_CAPTURE_DIAGNOSTIC', enabled ? '1' : '0')
  vi.stubEnv('HRONAUT_CAPTURE_DIAGNOSTIC_PATH', '')
  const app = new EventEmitter()
  const nativeCalls: { receiver: unknown; args: unknown[] }[] = []
  class View {
    children: View[] = []
    bounds = { x: 0, y: 0, width: 100, height: 80 }
    visible = true
    failure: Error | undefined
    addChildView(...args: [View, number?]) {
      nativeCalls.push({ receiver: this, args })
      if (this.failure) throw this.failure
      this.children.push(args[0])
    }
    removeChildView(...args: [View]) {
      nativeCalls.push({ receiver: this, args })
      if (this.failure) throw this.failure
      this.children = this.children.filter(child => child !== args[0])
    }
    getBounds() { return this.bounds }
    setBounds(bounds: typeof this.bounds) { if (this.failure) throw this.failure; this.bounds = bounds }
    getVisible() { return this.visible }
    setVisible(visible: boolean) { this.visible = visible }
  }
  class WebContentsView extends View {
    constructor(readonly webContents: WebContents) { super() }
  }
  const root = new View()
  const contents: WebContents[] = []
  vi.doMock('electron', () => ({ app, View, WebContentsView,
    BrowserWindow: { getAllWindows: () => [{ id: 1, contentView: root, isVisible: () => true, isMinimized: () => false }] },
    webContents: { getAllWebContents: () => contents } }))
  const module = await import('../src/main/capture-order-diagnostic.js')
  module.installCaptureDiagnostic()
  const image = { getSize: () => ({ width: 100, height: 80 }), isEmpty: () => false }
  function page(id: number) {
    const capture = vi.fn(function (this: unknown, ..._args: unknown[]) { return Promise.resolve(image) })
    const value = Object.assign(new EventEmitter(), { id, isDestroyed: () => false, isLoadingMainFrame: () => false, capturePage: capture })
    const native = value as unknown as WebContents
    contents.push(native)
    app.emit('web-contents-created', {}, native)
    return { native, capture, emitter: value }
  }
  return { ...module, app, root, WebContentsView, nativeCalls, page, image,
    snapshot: () => (globalThis as CaptureDiagnosticGlobal).__captureOrderDiagnostic?.snapshot() }
}
afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock('electron'); delete (globalThis as CaptureDiagnosticGlobal).__captureOrderDiagnostic })
describe('diagnostic native forwarding', () => {
  it('starts before contents and observes actual attachment, layout, navigation and cleanup', async () => {
    const probe = await setup()
    expect(probe.snapshot()?.events[0]).toMatchObject({ event: 'installed', preexisting: 0 })
    const page = probe.page(3)
    const view = new probe.WebContentsView(page.native)
    probe.root.addChildView(view)
    expect(probe.nativeCalls[0]).toEqual({ receiver: probe.root, args: [view] })
    view.setBounds({ x: 0, y: 105, width: 1320, height: 755 })
    view.setVisible(false)
    page.emitter.emit('did-start-navigation', {}, 'private-url', false, true)
    const result = await probe.diagnosticCapture(page.native, 'foreground')
    expect(result).toBe(probe.image)
    const rows = probe.snapshot()!.events
    expect(rows.find(row => row.event === 'add-return')).toMatchObject({ attached: true, attachmentGeneration: 1 })
    expect(rows.find(row => row.event === 'capture-start')).toMatchObject({ owner: 'foreground', active: 1,
      width: 1320, height: 755, visible: false, layoutGeneration: 2, navigationGeneration: 1 })
    expect(JSON.stringify(rows)).not.toContain('private-url')
    probe.root.removeChildView(view)
    expect(probe.nativeCalls[1]?.args).toHaveLength(1)
    expect(probe.snapshot()?.events.find(row => row.event === 'remove-return')).toMatchObject({ attached: false, attachmentGeneration: 2 })
    probe.app.emit('before-quit'); probe.app.emit('will-quit')
    expect(probe.snapshot()).toMatchObject({ beforeQuit: true, willQuit: true })
  })
  it('preserves receiver, arguments, result/error identity and records real concurrent owners', async () => {
    const probe = await setup()
    const page = probe.page(3)
    let resolve!: (value: typeof probe.image) => void
    page.capture.mockImplementationOnce(function (this: unknown, ...args) {
      expect(this).toBe(page.native)
      expect(args).toEqual([undefined, { stayHidden: true }])
      return new Promise(done => { resolve = done })
    })
    const first = probe.diagnosticCapture(page.native, 'foreground', undefined, { stayHidden: true })
    expect(first).toBe(page.capture.mock.results[0]?.value)
    await probe.diagnosticCapture(page.native, 'thumbnail')
    expect(probe.snapshot()?.events.filter(row => row.event === 'capture-start').map(row => [row.owner, row.active])).toEqual([['foreground', 1], ['thumbnail', 2]])
    resolve(probe.image); expect(await first).toBe(probe.image)
    const error = new Error('UnknownVizError private-path')
    page.capture.mockRejectedValueOnce(error)
    await expect(probe.diagnosticCapture(page.native, 'foreground')).rejects.toBe(error)
    page.capture.mockImplementationOnce(() => { throw error })
    expect(() => probe.diagnosticCapture(page.native, 'foreground')).toThrow(error)
    expect(JSON.stringify(probe.snapshot())).not.toContain('private-path')
    expect(probe.snapshot()?.events.filter(row => row.event === 'capture-error')).toHaveLength(2)
  })
  it('preserves native mutation errors and does not claim a successful transition', async () => {
    const probe = await setup()
    const page = probe.page(3)
    const view = new probe.WebContentsView(page.native)
    const error = new Error('native failure')
    probe.root.failure = error
    expect(() => probe.root.addChildView(view)).toThrow(error)
    expect(probe.snapshot()?.events.some(row => row.event === 'add-return')).toBe(false)
    expect(probe.snapshot()?.events.some(row => row.event === 'add-throw')).toBe(true)
  })
  it('caps tracked contents and marks omissions', async () => {
    const probe = await setup()
    for (let id = 1; id <= 70; id++) probe.page(id)
    expect(probe.snapshot()?.omittedContents).toBe(6)
  })
  it('does not install native hooks without the explicit diagnostic flag', async () => {
    const probe = await setup(false)
    const page = probe.page(3)
    expect(page.native.capturePage).toBe(page.capture)
    expect(probe.snapshot()).toBeUndefined()
  })
})

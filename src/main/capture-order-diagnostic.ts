// DIAGNOSTIC BRANCH ONLY: never merge this module or its callsite instrumentation.
import { app, BrowserWindow, View, WebContentsView, webContents } from 'electron'
import type { WebContents } from 'electron'
import { writeFileSync } from 'node:fs'
import { CaptureRing } from './capture-order-state.js'
import type { CaptureEvent, EventName, Owner } from './capture-order-state.js'
const ring = new CaptureRing()
const started = performance.now()
let enabled = false
let owner: Owner = 'other'
const generations = new Map<number, { attachmentGeneration: number; layoutGeneration: number; navigationGeneration: number }>()
function record(event: EventName, detail: Omit<CaptureEvent, 'event' | 'ms'> = {}): void {
  if (!enabled) return
  try { ring.record({ event, ms: performance.now() - started, ...detail }) } catch {
    // Instrumentation must never replace an application return or exception.
    try { ring.record({ event, ms: 0, unavailable: true }) } catch { /* No safe observation remains. */ }
  }
}
function observeSafely(event: EventName, detail: () => Omit<CaptureEvent, 'event' | 'ms'>): void {
  if (!enabled) return
  try { record(event, detail()) } catch { record(event, { unavailable: true }) }
}
export function captureDiagnosticEvent(event: EventName, page: WebContents): void {
  observeSafely(event, () => ({ id: page.id }))
}
export function diagnosticCapture(page: WebContents, label: Owner, ...args: Parameters<WebContents['capturePage']>): ReturnType<WebContents['capturePage']> {
  const previous = owner
  owner = label
  try { return page.capturePage(...args) } finally { owner = previous }
}
function snapshot(page: WebContents): Omit<CaptureEvent, 'event' | 'ms'> {
  try {
    if (page.isDestroyed()) return { id: page.id, destroyed: true }
    for (const window of BrowserWindow.getAllWindows()) {
      for (const child of window.contentView.children) {
        if ((child as WebContentsView).webContents === page) {
          return { id: page.id, attached: true, parent: window.id, ...child.getBounds(),
            visible: window.isVisible() && !window.isMinimized() && child.getVisible(),
            loading: page.isLoadingMainFrame(), ...generations.get(page.id) }
        }
      }
    }
    return { id: page.id, attached: false, loading: page.isLoadingMainFrame(), ...generations.get(page.id) }
  } catch { return { unavailable: true } }
}
export function installCaptureDiagnostic(): void {
  if (process.env.HRONAUT_CAPTURE_DIAGNOSTIC !== '1' || enabled) return
  enabled = true
  try { installObservers() } catch { record('observation-unavailable') }
}
function installObservers(): void {
  const preexisting = webContents.getAllWebContents()
  record('installed', { preexisting: preexisting.length })
  const observe = (page: WebContents): void => {
    try { observePage(page) } catch { record('observation-unavailable') }
  }
  const observePage = (page: WebContents): void => {
    if (generations.has(page.id)) return
    if (generations.size >= 64) { ring.omittedContents++; return }
    const id = page.id
    const generation = { attachmentGeneration: 0, layoutGeneration: 0, navigationGeneration: 0 }
    generations.set(id, generation)
    record('created', { id })
    page.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
      if (mainFrame) generation.navigationGeneration++
      record('navigation-start', { ...snapshot(page), mainFrame })
    })
    page.on('did-frame-navigate', (_event, _url, _code, _status, mainFrame) => record('navigation-commit', { ...snapshot(page), mainFrame }))
    page.on('did-start-loading', () => record('load-start', snapshot(page)))
    page.on('did-stop-loading', () => record('load-stop', snapshot(page)))
    page.on('render-process-gone', () => record('renderer-gone', { id }))
    page.on('destroyed', () => { record('destroyed', { id }); generations.delete(id) })
    const original = page.capturePage
    let active = 0
    let sequence = 0
    page.capturePage = function (...args) {
      const call = ++sequence
      const label = owner
      active++
      observeSafely('capture-start', () => ({ ...snapshot(page), call, active, owner: label }))
      const failed = (error: unknown): void => {
        observeSafely('capture-error', () => ({ ...snapshot(page), call, active, owner: label,
          unknownViz: error instanceof Error && error.message.includes('UnknownVizError') }))
      }
      let pending: ReturnType<WebContents['capturePage']>
      try { pending = original.apply(this, args) } catch (error) {
        failed(error)
        active--
        throw error
      }
      // Observe settlement without replacing the promise returned to production code.
      try {
        void pending.then(image => {
          try {
            observeSafely('capture-success', () => {
              const size = image.getSize()
              return { ...snapshot(page), call, active, owner: label,
                imageWidth: size.width, imageHeight: size.height, empty: image.isEmpty() }
            })
          } finally { active-- }
        }, error => {
          try { failed(error) } finally { active-- }
        }).catch(() => { ring.invalid++ })
      } catch { active--; record('observation-unavailable', { call }) }
      return pending
    }
  }
  app.on('web-contents-created', (_event, page) => observe(page))
  for (const page of preexisting) observe(page)
  for (const [method, prefix] of [['addChildView', 'add'], ['removeChildView', 'remove']] as const) {
    const original = View.prototype[method]
    View.prototype[method] = function (...args: [View, number?]) {
      const [child] = args
      const read = () => {
        const page = (child as WebContentsView).webContents
        return page ? snapshot(page) : {}
      }
      observeSafely(`${prefix}-enter`, read)
      let result: ReturnType<typeof original>
      try { result = Reflect.apply(original, this, args) } catch (error) {
        observeSafely(`${prefix}-throw`, read)
        throw error
      }
      observeSafely(`${prefix}-return`, () => {
        const page = (child as WebContentsView).webContents
        const generation = page && generations.get(page.id)
        if (generation) generation.attachmentGeneration++
        return read()
      })
      return result
    }
  }
  const bounds = WebContentsView.prototype.setBounds
  WebContentsView.prototype.setBounds = function (value) {
    observeSafely('bounds-enter', () => snapshot(this.webContents))
    let result: ReturnType<typeof bounds>
    try { result = bounds.call(this, value) } catch (error) {
      observeSafely('bounds-throw', () => snapshot(this.webContents))
      throw error
    }
    observeSafely('bounds-return', () => {
      const generation = generations.get(this.webContents.id)
      if (generation) generation.layoutGeneration++
      return { ...snapshot(this.webContents), ...this.getBounds() }
    })
    return result
  }
  const visible = WebContentsView.prototype.setVisible
  WebContentsView.prototype.setVisible = function (value) {
    observeSafely('visible-enter', () => snapshot(this.webContents))
    let result: ReturnType<typeof visible>
    try { result = visible.call(this, value) } catch (error) {
      observeSafely('visible-throw', () => snapshot(this.webContents))
      throw error
    }
    observeSafely('visible-return', () => {
      const generation = generations.get(this.webContents.id)
      if (generation) generation.layoutGeneration++
      return { ...snapshot(this.webContents), visible: this.getVisible() }
    })
    return result
  }
  const save = (): void => {
    // Only an explicit diagnostic path supplied by the isolated fixture; never exported.
    if (process.env.HRONAUT_CAPTURE_DIAGNOSTIC_PATH) {
      try { writeFileSync(process.env.HRONAUT_CAPTURE_DIAGNOSTIC_PATH, JSON.stringify(ring.snapshot())) } catch { /* Exporter reports missing telemetry. */ }
    }
  }
  app.on('before-quit', () => { record('before-quit'); save() })
  app.on('will-quit', () => { record('will-quit'); save() })
  ;(globalThis as CaptureDiagnosticGlobal).__captureOrderDiagnostic = { record, save, snapshot: () => ring.snapshot() }
}

export type CaptureDiagnosticGlobal = typeof globalThis & {
  __captureOrderDiagnostic?: { record: typeof record; save(): void; snapshot(): ReturnType<CaptureRing['snapshot']> }
}

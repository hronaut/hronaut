import type { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import type { ElectronApplication, TestInfo } from '@playwright/test'
import type { WebContents, WebContentsView } from 'electron'

type DiagnosticEvent = { ms: number; event: string } & Record<string, unknown>
export type CaptureDiagnosticGlobal = typeof globalThis & {
  __captureOrderDiagnostic?: {
    events: DiagnosticEvent[]
    dropped: number
    record(event: string, detail?: Record<string, unknown>): void
    restore(): void
  }
}

// Diagnostic branch only. No frame subscription, invalidation, delay or capture retry.
export async function installCaptureDiagnostic(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ app, BrowserWindow, WebContentsView }) => {
    const started = performance.now()
    const events: DiagnosticEvent[] = []
    const cleanups: (() => void)[] = []
    const state = {
      events, dropped: 0,
      record: (event: string, detail: Record<string, unknown> = {}) => {
        if (events.length < 300) events.push({ ms: performance.now() - started, event, ...detail })
        else state.dropped++
      },
      restore: () => { for (const cleanup of cleanups.reverse()) cleanup() }
    }
    const proto = WebContentsView.prototype
    const ownedBounds = Object.prototype.hasOwnProperty.call(proto, 'setBounds')
    const ownedVisible = Object.prototype.hasOwnProperty.call(proto, 'setVisible')
    const originalBounds = proto.setBounds
    const originalVisible = proto.setVisible
    proto.setBounds = function (bounds) {
      state.record('set-bounds', { id: this.webContents.id, bounds })
      return originalBounds.call(this, bounds)
    }
    proto.setVisible = function (visible) {
      state.record('set-visible', { id: this.webContents.id, visible })
      return originalVisible.call(this, visible)
    }
    cleanups.push(() => {
      if (ownedBounds) proto.setBounds = originalBounds
      else Reflect.deleteProperty(proto, 'setBounds')
      if (ownedVisible) proto.setVisible = originalVisible
      else Reflect.deleteProperty(proto, 'setVisible')
    })
    const observe = (_event: Electron.Event, page: WebContents): void => {
      const id = page.id
      let active = 0
      let sequence = 0
      const snapshot = () => page.isDestroyed() ? { id, destroyed: true } : ({
        id, loading: page.isLoadingMainFrame(), crashed: page.isCrashed(), pid: page.getOSProcessId(),
        windows: BrowserWindow.getAllWindows().map(window => ({
          visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused(),
          views: window.contentView.children
            .filter(view => (view as WebContentsView).webContents?.id === id)
            .map(view => ({ bounds: view.getBounds(), visible: view.getVisible() }))
        }))
      })
      state.record('created', { id })
      const emitter: EventEmitter = page
      for (const name of ['did-start-loading', 'did-stop-loading', 'dom-ready', 'did-finish-load', 'render-process-gone']) {
        const listener = () => state.record(name, snapshot())
        emitter.on(name, listener)
        cleanups.push(() => { emitter.removeListener(name, listener) })
      }
      const original = page.capturePage
      page.capturePage = async function (...args) {
        const call = ++sequence
        // Whitelist known ownership labels; do not retain stack paths, URLs or text.
        const stack = new Error().stack ?? ''
        const caller = ['withRenderableTab', 'performTabOverviewPreviewCapture', 'NativePreviewCapture', 'waitForPresentation']
          .filter(label => stack.includes(label))
        state.record('capture-start', { ...snapshot(), call, active: ++active, caller })
        try {
          const image = await original.apply(this, args)
          state.record('capture-success', { ...snapshot(), call, size: image.getSize(), empty: image.isEmpty() })
          return image
        } catch (error) {
          state.record('capture-error', { ...snapshot(), call, unknownViz: String(error).includes('UnknownVizError') })
          throw error
        } finally { active-- }
      }
      cleanups.push(() => { page.capturePage = original })
    }
    app.on('web-contents-created', observe)
    cleanups.push(() => { app.removeListener('web-contents-created', observe) })
    ;(globalThis as CaptureDiagnosticGlobal).__captureOrderDiagnostic = state
  })
}

export async function attachCaptureDiagnostic(electronApp: ElectronApplication, info: TestInfo): Promise<void> {
  const result = await electronApp.evaluate(() => {
    const global = globalThis as CaptureDiagnosticGlobal
    const state = global.__captureOrderDiagnostic!
    const result = { events: state.events, dropped: state.dropped }
    state.restore()
    delete global.__captureOrderDiagnostic
    return result
  })
  await info.attach('bounded-native-capture-events', { body: JSON.stringify(result), contentType: 'application/json' })
}

export async function attachCaptureResources(info: TestInfo, phase: string): Promise<void> {
  const resources = Object.fromEntries(await Promise.all([
    '/sys/fs/cgroup/memory.events', '/sys/fs/cgroup/memory.current', '/sys/fs/cgroup/memory.max',
    '/sys/fs/cgroup/cpu.stat', '/sys/fs/cgroup/cpu.pressure', '/sys/fs/cgroup/memory.pressure'
  ].map(async path => [path, await readFile(path, 'utf8').then(value => value.slice(0, 4096)).catch(() => 'unavailable')])))
  await info.attach(`capture-resources-${phase}`, { body: JSON.stringify(resources), contentType: 'application/json' })
}

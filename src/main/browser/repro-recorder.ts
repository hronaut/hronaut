import type { WebContents, WebContentsView } from 'electron'
import type { BrowserReproAction, BrowserReproRecording, BrowserReproStep, BrowserReproTarget } from '../../shared/types.js'
import { redactDiagnosticText } from '../../shared/debug-report.js'
import { redactNetworkUrl } from '../../shared/network-details.js'
import { reproScrollScript, reproTargetScript } from './repro-page-scripts.js'
import { isHronautHomeUrl } from './url.js'

const MAX_REPRO_STEPS = 200

export interface BrowserReproRecordingInternal {
  active: boolean
  startedAt: string
  startedAtMonotonicMs: number
  stoppedAt?: string
  steps: BrowserReproStep[]
  truncated: boolean
  queue: Promise<void>
  scrollPosition: { x: number; y: number }
  scrollTimer?: NodeJS.Timeout
  pendingPointer?: {
    x: number
    y: number
    navigationGeneration: number
    target: Promise<BrowserReproTarget | null>
  }
}

interface BrowserReproStepContext {
  recording: BrowserReproRecordingInternal
  navigationGeneration: number
}

interface ReproTab {
  id: string
  title: string
  url: string
  navigationGeneration: number
  observationGeneration: number
  webContents: WebContents
  view: Pick<WebContentsView, 'getBounds'>
  reproRecording?: BrowserReproRecordingInternal
}

interface ReproRecorderHost<T> {
  isCurrent(tab: T): boolean
  isAgentInput(webContents: WebContents): boolean
  changed(): void
}

/** Own recorder tasks and cleanup together; the manager retains tab authority. */
export class BrowserReproRecorder<T extends ReproTab> {
  private readonly pendingReproStarts = new WeakMap<T, symbol>()
  private readonly pendingReproStops = new WeakMap<BrowserReproRecordingInternal, Promise<BrowserReproRecording>>()

  constructor(private readonly host: ReproRecorderHost<T>) {}

  async manage(tab: T, action: BrowserReproAction): Promise<BrowserReproRecording> {
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before recording reproduction steps')

    if (action === 'start') {
      this.clearReproRecording(tab)
      const start = Symbol('repro start')
      this.pendingReproStarts.set(tab, start)
      const webContents = tab.webContents
      const navigationGeneration = tab.navigationGeneration
      const observationGeneration = tab.observationGeneration
      const startedAtMs = Date.now()
      const startedAtMonotonicMs = performance.now()
      const initialScroll = await webContents.executeJavaScript(reproScrollScript(), true)
        .catch(() => ({ x: 0, y: 0 })) as { x: number; y: number }
      const ownsStart = this.pendingReproStarts.get(tab) === start
      if (ownsStart) this.pendingReproStarts.delete(tab)
      if (!ownsStart || !this.host.isCurrent(tab)
        || tab.webContents !== webContents || webContents.isDestroyed()
        || tab.navigationGeneration !== navigationGeneration
        || tab.observationGeneration !== observationGeneration) {
        throw new Error('Reproduction recording changed while starting')
      }
      tab.reproRecording = {
        active: true,
        startedAt: new Date(startedAtMs).toISOString(),
        startedAtMonotonicMs,
        steps: [],
        truncated: false,
        queue: Promise.resolve(),
        scrollPosition: {
          x: Number.isFinite(initialScroll.x) ? Math.round(initialScroll.x) : 0,
          y: Number.isFinite(initialScroll.y) ? Math.round(initialScroll.y) : 0
        }
      }
      this.addReproStep(tab, {
        kind: 'navigate',
        description: `Open ${redactNetworkUrl(tab.url)}`
      })
      this.host.changed()
      return this.reproRecordingResult(tab)
    }

    if (action === 'clear') {
      this.clearReproRecording(tab)
      this.host.changed()
      return this.reproRecordingResult(tab)
    }

    if (action === 'stop') this.pendingReproStarts.delete(tab)
    const recording = tab.reproRecording
    if (!recording) return this.reproRecordingResult(tab)
    if (action === 'get') return this.reproRecordingResult(tab)
    return this.stopReproRecording(tab, recording)
  }

  private async stopReproRecording(tab: T, recording: BrowserReproRecordingInternal): Promise<BrowserReproRecording> {
    const existing = this.pendingReproStops.get(recording)
    if (existing) return existing
    const assertCurrent = () => {
      if (!this.host.isCurrent(tab) || tab.reproRecording !== recording) {
        throw new Error('Reproduction recording changed while stopping')
      }
    }
    const stop = (async () => {
      assertCurrent()
      if (recording.active) {
        await recording.queue.catch(() => undefined)
        assertCurrent()
        if (recording.scrollTimer) {
          clearTimeout(recording.scrollTimer)
          recording.scrollTimer = undefined
          await this.captureReproScroll(tab)
          assertCurrent()
        }
        recording.active = false
        recording.stoppedAt = new Date().toISOString()
        recording.pendingPointer = undefined
      }
      await recording.queue.catch(() => undefined)
      assertCurrent()
      this.host.changed()
      return this.reproRecordingResult(tab)
    })()
    this.pendingReproStops.set(recording, stop)
    try {
      return await stop
    } finally {
      this.pendingReproStops.delete(recording)
    }
  }

  navigated(tab: T, url: string, sameDocument: boolean): void {
    if (!tab.reproRecording?.active) return
    // A new document has its own scroll coordinate space.
    if (!sameDocument) tab.reproRecording.scrollPosition = { x: 0, y: 0 }
    this.addReproStep(tab, {
      kind: 'navigate',
      description: `${sameDocument ? 'Navigate within the page to' : 'Navigate to'} ${redactNetworkUrl(url)}`
    })
    if (sameDocument) this.refreshReproScrollPosition(tab)
  }

  clearReproRecording(tab: T): void {
    this.pendingReproStarts.delete(tab)
    const recording = tab.reproRecording
    if (recording?.scrollTimer) {
      clearTimeout(recording.scrollTimer)
      recording.scrollTimer = undefined
    }
    if (recording) recording.active = false
    tab.reproRecording = undefined
  }

  private reproRecordingResult(tab: T): BrowserReproRecording {
    const recording = tab.reproRecording
    return {
      tabId: tab.id,
      title: redactDiagnosticText(tab.title).slice(0, 500),
      ...(recording ? { startedAt: recording.startedAt } : {}),
      ...(recording?.stoppedAt ? { stoppedAt: recording.stoppedAt } : {}),
      active: recording?.active === true,
      stepCount: recording?.steps.length ?? 0,
      steps: (recording?.steps ?? []).map((step) => ({
        ...step,
        ...(step.target ? { target: { ...step.target } } : {}),
        ...(step.scroll ? { scroll: { ...step.scroll } } : {})
      })),
      truncated: recording?.truncated === true,
      caveats: [
        'Typed values, clipboard contents, uploaded file paths, screenshots, and page HTML are never recorded.',
        'Selectors use only structural tag positions and can require adjustment after the page changes.',
        'The recorder captures accepted human input and top-level navigation in this tab; MCP tool actions are not duplicated in the timeline.',
        `The timeline keeps at most ${MAX_REPRO_STEPS} steps in memory and is discarded when the tab or Hronaut closes.`
      ]
    }
  }

  private addReproStep(
    tab: T,
    value: Pick<BrowserReproStep, 'kind' | 'description'>
      & Partial<Pick<BrowserReproStep, 'target' | 'key' | 'scroll' | 'valueRedacted'>>,
    expectedContext?: BrowserReproStepContext
  ): void {
    const recording = tab.reproRecording
    if (!recording?.active || (expectedContext && (
      recording !== expectedContext.recording
      || tab.navigationGeneration !== expectedContext.navigationGeneration
    ))) return
    const now = Date.now()
    const elapsedMs = Math.max(0, Math.round(performance.now() - recording.startedAtMonotonicMs))
    const target = value.target
    const last = recording.steps.at(-1)
    if (
      value.kind === 'input'
      && last?.kind === 'input'
      && Boolean(target?.selector)
      && last.target?.selector === target?.selector
      && elapsedMs - last.elapsedMs <= 1_500
    ) {
      last.occurredAt = new Date(now).toISOString()
      last.elapsedMs = elapsedMs
      this.host.changed()
      return
    }
    if (recording.steps.length >= MAX_REPRO_STEPS) {
      recording.truncated = true
      return
    }
    recording.steps.push({
      index: recording.steps.length + 1,
      kind: value.kind,
      occurredAt: new Date(now).toISOString(),
      elapsedMs,
      description: redactDiagnosticText(value.description).slice(0, 500),
      url: redactNetworkUrl(tab.url),
      ...(target ? { target: { ...target } } : {}),
      ...(value.key ? { key: value.key } : {}),
      ...(value.scroll ? { scroll: { ...value.scroll } } : {}),
      ...(value.valueRedacted ? { valueRedacted: true } : {})
    })
    this.host.changed()
  }

  private queueReproTask(
    tab: T,
    task: (context: BrowserReproStepContext) => Promise<void>,
    navigationGeneration = tab.navigationGeneration
  ): void {
    const recording = tab.reproRecording
    if (!recording?.active) return
    const context = { recording, navigationGeneration }
    const queued = recording.queue.catch(() => undefined).then(async () => {
      if (!recording.active
        || tab.reproRecording !== recording
        || tab.navigationGeneration !== navigationGeneration) return
      await task(context)
    })
    recording.queue = queued
    void queued.catch((error) => {
      if (recording.active && tab.reproRecording === recording) {
        console.warn('[browser] Could not record a reproduction step:', error)
      }
    })
  }

  private async reproTarget(
    tab: T,
    point?: { x: number; y: number; viewportWidth: number; viewportHeight: number }
  ): Promise<BrowserReproTarget | null> {
    if (tab.webContents.isDestroyed()) return null
    const target = await tab.webContents.executeJavaScript(reproTargetScript(point), true) as BrowserReproTarget | null
    if (!target?.tag) return null
    const clean = (value: string | undefined, limit: number): string | undefined => {
      if (!value) return undefined
      const next = redactDiagnosticText(value).replace(/\s+/g, ' ').trim().slice(0, limit)
      return next || undefined
    }
    return {
      selector: target.selector && clean(target.selector, 500) === target.selector ? target.selector : '',
      tag: clean(target.tag, 64) ?? 'element',
      ...(clean(target.role, 64) ? { role: clean(target.role, 64) } : {}),
      ...(clean(target.label, 180) ? { label: clean(target.label, 180) } : {}),
      ...(clean(target.inputType, 40) ? { inputType: clean(target.inputType, 40) } : {})
    }
  }

  private reproTargetName(target: BrowserReproTarget): string {
    const kind = target.role || (target.tag === 'input' && target.inputType ? `${target.inputType} input` : target.tag)
    return target.label ? `${kind} “${target.label}”` : kind
  }

  observeReproMouse(tab: T, mouse: Electron.MouseInputEvent): void {
    const recording = tab.reproRecording
    if (!recording?.active || this.host.isAgentInput(tab.webContents)) return
    if (mouse.type === 'mouseDown' && (mouse.button === undefined || mouse.button === 'left')) {
      const bounds = tab.view.getBounds()
      recording.pendingPointer = {
        x: mouse.x,
        y: mouse.y,
        navigationGeneration: tab.navigationGeneration,
        target: this.reproTarget(tab, {
          x: mouse.x,
          y: mouse.y,
          viewportWidth: Math.max(1, bounds.width),
          viewportHeight: Math.max(1, bounds.height)
        }).catch(() => null)
      }
    } else if (mouse.type === 'mouseUp' && (mouse.button === undefined || mouse.button === 'left')) {
      const pending = recording.pendingPointer
      recording.pendingPointer = undefined
      if (pending && Math.hypot(mouse.x - pending.x, mouse.y - pending.y) <= 8) {
        this.queueReproTask(tab, async (context) => {
          const target = await pending.target
          if (target) this.addReproStep(tab, {
            kind: 'click',
            description: `Click ${this.reproTargetName(target)}`,
            target
          }, context)
        }, pending.navigationGeneration)
      }
      this.scheduleReproScroll(tab)
    } else if (mouse.type === 'mouseWheel') {
      this.scheduleReproScroll(tab)
    }
  }

  observeReproKeyboard(tab: T, input: Electron.Input): void {
    const recording = tab.reproRecording
    if (!recording?.active || input.type !== 'keyDown' || input.isAutoRepeat || this.host.isAgentInput(tab.webContents)) return
    const hasCommandModifier = input.control || input.meta || input.alt
    const editsValue = !hasCommandModifier && (input.key.length === 1 || ['Backspace', 'Delete'].includes(input.key))
    const allowedKey = ['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', ' ']
    if (!editsValue && !hasCommandModifier && !allowedKey.includes(input.key)) return
    this.queueReproTask(tab, async (context) => {
      const target = await this.reproTarget(tab).catch(() => null)
      if (!target) return
      if (editsValue) {
        this.addReproStep(tab, {
          kind: 'input',
          description: `Type in ${this.reproTargetName(target)} (value not recorded)`,
          target,
          valueRedacted: true
        }, context)
        return
      }
      const key = [input.control ? 'Ctrl' : '', input.meta ? 'Meta' : '', input.alt ? 'Alt' : '', input.shift ? 'Shift' : '', input.key === ' ' ? 'Space' : input.key]
        .filter(Boolean)
        .join('+')
        .slice(0, 80)
      this.addReproStep(tab, {
        kind: 'key',
        description: `Press ${key} on ${this.reproTargetName(target)}`,
        target,
        key
      }, context)
    })
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(input.key)) this.scheduleReproScroll(tab)
  }

  private scheduleReproScroll(tab: T): void {
    const recording = tab.reproRecording
    if (!recording?.active) return
    if (recording.scrollTimer) clearTimeout(recording.scrollTimer)
    recording.scrollTimer = setTimeout(() => {
      recording.scrollTimer = undefined
      this.queueReproTask(tab, async () => {
        await this.captureReproScroll(tab)
      })
    }, 250)
    recording.scrollTimer.unref()
  }

  refreshReproScrollPosition(tab: T): void {
    const recording = tab.reproRecording
    if (!recording?.active || tab.webContents.isDestroyed()) return
    const navigationGeneration = tab.navigationGeneration
    void tab.webContents.executeJavaScript(reproScrollScript(), true)
      .then((scroll: { x: number; y: number }) => {
        if (tab.reproRecording !== recording
          || !recording.active
          || tab.navigationGeneration !== navigationGeneration) return
        if (!Number.isFinite(scroll.x) || !Number.isFinite(scroll.y)) return
        recording.scrollPosition = { x: Math.round(scroll.x), y: Math.round(scroll.y) }
      })
      .catch(() => undefined)
  }

  private async captureReproScroll(tab: T): Promise<void> {
    const recording = tab.reproRecording
    if (!recording?.active || tab.webContents.isDestroyed()) return
    const navigationGeneration = tab.navigationGeneration
    const scroll = await tab.webContents.executeJavaScript(reproScrollScript(), true) as { x: number; y: number }
    if (tab.reproRecording !== recording
      || !recording.active
      || tab.navigationGeneration !== navigationGeneration) return
    if (!Number.isFinite(scroll.x) || !Number.isFinite(scroll.y)) return
    const normalized = { x: Math.round(scroll.x), y: Math.round(scroll.y) }
    const previous = recording.scrollPosition
    recording.scrollPosition = normalized
    if (Math.abs(previous.x - normalized.x) < 8 && Math.abs(previous.y - normalized.y) < 8) return
    this.addReproStep(tab, {
      kind: 'scroll',
      description: `Scroll to x=${normalized.x}, y=${normalized.y}`,
      scroll: normalized
    })
  }

}

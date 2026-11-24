import { randomBytes } from 'node:crypto'
import type { WebContents } from 'electron'
import {
  ARIA_NOTIFY_CAVEATS,
  ARIA_NOTIFY_LIMITS,
  ariaNotifyDuration,
  type AriaNotifyAction,
  type AriaNotifyAnnouncement,
  type AriaNotifyCallSite,
  type AriaNotifyEndReason,
  type AriaNotifyReport
} from '../../../shared/aria-notify.js'
import { pageScript } from '../../../shared/page-script.js'
import { installAriaNotifyRecorder, removeAriaNotifyRecorder } from './aria-notify.page.js'

export interface AriaNotifyTab {
  id: string
  webContents: WebContents
}

/** The starting call's authority over the tab, checked on every navigation and twice a second while recording. */
export interface AriaNotifyAuthority { assertCurrent(): void }

export interface AriaNotifyHost<T> {
  isCurrent(tab: T): boolean
  isDevToolsOpening(tab: T): boolean
  /** Runs in the tab's debugger queue after attaching; rejects while Developer Tools are open. */
  withDebugger<R>(tab: T, operation: () => Promise<R>): Promise<R>
}

interface Recording {
  origin: string
  binding: string
  webContents: WebContents
  authority: AriaNotifyAuthority
  started: boolean
  startedAt: number
  startedMonotonic: number
  expiresAt: number
  deadlineMonotonic: number
  scriptId?: string
  supported: boolean
  announcements: AriaNotifyAnnouncement[]
  totalChars: number
  dropped: number
  expiry?: ReturnType<typeof setTimeout>
  check?: ReturnType<typeof setInterval>
  release: () => void
}

interface Kept {
  origin: string
  supported: boolean
  announcements: AriaNotifyAnnouncement[]
  dropped: number
  ended: { reason: AriaNotifyEndReason; endedAt: string }
}

const CHECK_MS = 500

function httpOrigin(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined
  } catch {
    return undefined
  }
}

/** An HTTP(S) address as origin and path only. */
function originAndPath(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    const value = `${parsed.origin}${parsed.pathname}`
    return value.length <= ARIA_NOTIFY_LIMITS.maxScriptUrlChars ? value : undefined
  } catch {
    return undefined
  }
}

/** The caller's frame from a V8 stack line, such as "    at announce (https://app.test/main.js?v=2:10:5)". */
export function ariaNotifyCallSite(line: string): AriaNotifyCallSite | undefined {
  const match = /^\s*at (?:(.*?) \()?(.*?):(\d+):(\d+)\)?\s*$/.exec(line)
  if (!match) return undefined
  const lineNumber = Number(match[3])
  const column = Number(match[4])
  if (!Number.isSafeInteger(lineNumber) || !Number.isSafeInteger(column)) return undefined
  const functionName = (match[1] ?? '').replace(/^async /, '').replace(/\p{Cc}/gu, ' ').trim()
    .slice(0, ARIA_NOTIFY_LIMITS.maxFunctionNameChars) || '(anonymous)'
  const scriptUrl = originAndPath(match[2] ?? '')
  return { functionName, ...(scriptUrl ? { scriptUrl } : {}), line: lineNumber, column }
}

/** One binding call as the page sent it, bounded and checked; undefined for anything that is not one. */
export function ariaNotifyAnnouncement(payload: string, atMs: number): AriaNotifyAnnouncement | undefined {
  let value: Record<string, unknown>
  try {
    value = JSON.parse(payload) as Record<string, unknown>
  } catch {
    return undefined
  }
  if (value === null || typeof value !== 'object' || typeof value.text !== 'string') return undefined
  const text = value.text.replace(/\p{Cc}/gu, ' ')
  const kept = text.slice(0, ARIA_NOTIFY_LIMITS.maxAnnouncementChars)
  const localName = typeof value.localName === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value.localName) ? value.localName : undefined
  const role = typeof value.role === 'string' && /^[a-z][a-z -]{0,63}$/i.test(value.role) ? value.role : undefined
  const callSite = typeof value.stack === 'string' ? ariaNotifyCallSite(value.stack) : undefined
  return {
    atMs: Math.max(0, Math.round(atMs)),
    text: kept,
    truncated: kept.length < text.length,
    ...(value.priority === 'normal' || value.priority === 'high' ? { priority: value.priority } : {}),
    target: localName ? { kind: 'element', localName, ...(role ? { role } : {}) } : { kind: 'document' },
    ...(callSite ? { callSite } : {}),
    pageUrl: (typeof value.url === 'string' ? originAndPath(value.url) : undefined) ?? ''
  }
}

/**
 * Records the announcements a tab's top-level page makes through document.ariaNotify and Element.ariaNotify, which
 * never reach the DOM. While recording, Hronaut's DevTools session adds a binding and a script that wraps both
 * functions in every new top-level document of the origin; each call reports through the binding and then runs as
 * before. Announcements stay in memory, bounded, for the tab only.
 */
export class AriaNotifyRecorder<T extends AriaNotifyTab> {
  private readonly recordings = new Map<T, Recording>()
  private readonly kept = new Map<T, Kept>()

  constructor(private readonly host: AriaNotifyHost<T>) {}

  active(tab: T): boolean {
    return this.recordings.get(tab)?.started === true
  }

  async manage(tab: T, action: AriaNotifyAction, options: { durationMs?: number }, authority: AriaNotifyAuthority): Promise<AriaNotifyReport> {
    if (action !== 'start' && options.durationMs !== undefined) throw new Error('durationMs is only for action start')
    if (action === 'start') await this.start(tab, ariaNotifyDuration(options.durationMs), authority)
    else if (action === 'stop') {
      const recording = this.recordings.get(tab)
      if (recording) this.end(tab, recording, 'stopped')
    } else if (action === 'clear') {
      const recording = this.recordings.get(tab)
      if (recording) this.end(tab, recording, 'stopped')
      this.kept.delete(tab)
    } else if (action !== 'get') throw new Error('Unsupported ariaNotify action')
    return this.report(tab)
  }

  /** Ends the recording for a reason from outside, such as an agent pause or a workspace control change. */
  stop(tab: T, reason: AriaNotifyEndReason): void {
    const recording = this.recordings.get(tab)
    if (recording) this.end(tab, recording, reason)
  }

  forget(tab: T): void {
    this.stop(tab, 'tab-closed')
    this.kept.delete(tab)
  }

  private async start(tab: T, durationMs: number, authority: AriaNotifyAuthority): Promise<void> {
    if (this.recordings.has(tab)) throw new Error('ariaNotify announcements are already being recorded in this tab; stop the recording before starting another')
    const webContents = tab.webContents
    if (webContents.isDestroyed() || webContents.isCrashed()) throw new Error('The page is not running; reload the tab before recording announcements')
    const origin = httpOrigin(webContents.getURL())
    if (!origin) throw new Error('Open an HTTP(S) page in this tab before recording announcements')
    authority.assertCurrent()
    const recording: Recording = {
      origin, binding: `__hronautAriaNotify${randomBytes(12).toString('hex')}`, webContents, authority, started: false,
      startedAt: Date.now(), startedMonotonic: performance.now(), expiresAt: 0, deadlineMonotonic: 0, supported: false,
      announcements: [], totalChars: 0, dropped: 0, release: () => undefined
    }
    this.recordings.set(tab, recording)
    this.watch(tab, recording)
    const assertCurrent = (): void => {
      if (this.recordings.get(tab) !== recording) {
        throw new Error('The recording ended while it was starting: the page left its origin, the agent lost its authority or the tab changed')
      }
      if (!this.host.isCurrent(tab) || tab.webContents !== webContents || webContents.isDestroyed()) {
        throw new Error('The tab changed while starting the recording')
      }
    }
    try {
      await this.host.withDebugger(tab, async () => {
        assertCurrent()
        await webContents.debugger.sendCommand('Runtime.addBinding', { name: recording.binding })
        assertCurrent()
        const added = await webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
          source: pageScript(installAriaNotifyRecorder, recording.binding)
        }) as { identifier?: unknown }
        if (typeof added.identifier === 'string') recording.scriptId = added.identifier
        assertCurrent()
        const evaluated = await webContents.debugger.sendCommand('Runtime.evaluate', {
          expression: pageScript(installAriaNotifyRecorder, recording.binding), returnByValue: true
        }) as { result?: { value?: { supported?: unknown } } }
        recording.supported = evaluated.result?.value?.supported === true
        assertCurrent()
        authority.assertCurrent()
      })
      assertCurrent()
    } catch (error) {
      if (this.recordings.get(tab) === recording) this.end(tab, recording, 'stopped', false)
      throw error
    }
    recording.started = true
    recording.startedAt = Date.now()
    recording.startedMonotonic = performance.now()
    recording.expiresAt = recording.startedAt + durationMs
    recording.deadlineMonotonic = recording.startedMonotonic + durationMs
    recording.expiry = setTimeout(() => this.end(tab, recording, 'expired'), durationMs)
    recording.check = setInterval(() => this.checkAuthority(tab, recording), CHECK_MS)
    this.kept.delete(tab)
  }

  private watch(tab: T, recording: Recording): void {
    const contents = recording.webContents
    const navigation = (_details: unknown, url: string, isSameDocument: boolean, isMainFrame: boolean): void => {
      if (!isMainFrame || isSameDocument) return
      if (httpOrigin(url) !== recording.origin) this.end(tab, recording, 'origin-left')
      else this.checkAuthority(tab, recording)
    }
    const rendererGone = (): void => this.end(tab, recording, 'renderer-exited')
    const destroyed = (): void => this.end(tab, recording, 'tab-closed')
    const devtools = (): void => this.end(tab, recording, 'devtools-opened')
    const detached = (): void => this.end(tab, recording, this.host.isDevToolsOpening(tab) ? 'devtools-opened' : 'debugger-detached')
    const message = (_event: unknown, method: string, params: { name?: unknown; payload?: unknown }): void => {
      if (method !== 'Runtime.bindingCalled' || params?.name !== recording.binding || typeof params.payload !== 'string') return
      this.record(recording, params.payload)
    }
    contents.on('did-start-navigation', navigation)
    contents.on('render-process-gone', rendererGone)
    contents.on('destroyed', destroyed)
    contents.on('devtools-opened', devtools)
    contents.debugger.on('detach', detached)
    contents.debugger.on('message', message)
    recording.release = () => {
      if (contents.isDestroyed()) return
      contents.removeListener('did-start-navigation', navigation)
      contents.removeListener('render-process-gone', rendererGone)
      contents.removeListener('destroyed', destroyed)
      contents.removeListener('devtools-opened', devtools)
      contents.debugger.removeListener('detach', detached)
      contents.debugger.removeListener('message', message)
    }
  }

  private record(recording: Recording, payload: string): void {
    // Calls made while the start is still checking are the page's too.
    const announcement = ariaNotifyAnnouncement(payload, performance.now() - recording.startedMonotonic)
    if (!announcement) return
    if (httpOrigin(recording.webContents.getURL()) !== recording.origin) return
    if (recording.announcements.length >= ARIA_NOTIFY_LIMITS.maxAnnouncements
      || recording.totalChars + announcement.text.length > ARIA_NOTIFY_LIMITS.maxTotalChars) {
      recording.dropped++
      return
    }
    recording.totalChars += announcement.text.length
    recording.announcements.push(announcement)
  }

  private checkAuthority(tab: T, recording: Recording): void {
    try {
      if (!this.host.isCurrent(tab) || tab.webContents !== recording.webContents) throw new Error('tab changed')
      recording.authority.assertCurrent()
    } catch {
      this.end(tab, recording, 'authority-changed')
    }
  }

  /** Ends the recording at once: the binding and the new-document script go, and the current document gets its functions back. */
  private end(tab: T, recording: Recording, reason: AriaNotifyEndReason, keep = true): void {
    if (this.recordings.get(tab) !== recording) return
    this.recordings.delete(tab)
    clearTimeout(recording.expiry)
    clearInterval(recording.check)
    recording.release()
    const contents = recording.webContents
    if (!contents.isDestroyed() && contents.debugger.isAttached()) {
      const send = (method: string, params: Record<string, unknown>): void => { void contents.debugger.sendCommand(method, params).catch(() => undefined) }
      send('Runtime.removeBinding', { name: recording.binding })
      if (recording.scriptId) send('Page.removeScriptToEvaluateOnNewDocument', { identifier: recording.scriptId })
      send('Runtime.evaluate', { expression: pageScript(removeAriaNotifyRecorder, recording.binding), returnByValue: true })
    }
    if (keep && recording.started) {
      this.kept.set(tab, {
        origin: recording.origin,
        supported: recording.supported,
        announcements: recording.announcements,
        dropped: recording.dropped,
        ended: { reason, endedAt: new Date().toISOString() }
      })
    }
  }

  private report(tab: T): AriaNotifyReport {
    const recording = this.recordings.get(tab)
    const active = recording?.started ? recording : undefined
    const kept = active ? undefined : this.kept.get(tab)
    const source = active ?? kept
    return {
      tabId: tab.id,
      url: originAndPath(tab.webContents.isDestroyed() ? '' : tab.webContents.getURL()) ?? '',
      status: active ? 'recording' : kept ? 'stopped' : 'idle',
      ...(source ? { supported: source.supported } : {}),
      ...(active ? {
        recording: {
          startedAt: new Date(active.startedAt).toISOString(),
          expiresAt: new Date(active.expiresAt).toISOString(),
          remainingMs: Math.max(0, Math.round(active.deadlineMonotonic - performance.now())),
          origin: active.origin
        }
      } : {}),
      announcements: [...(source?.announcements ?? [])],
      dropped: source?.dropped ?? 0,
      ...(kept ? { ended: { ...kept.ended } } : {}),
      limits: { ...ARIA_NOTIFY_LIMITS },
      caveats: [...ARIA_NOTIFY_CAVEATS]
    }
  }
}

import { app, webContents as electronWebContents, type WebContents } from 'electron'
import { isHronautHomeUrl } from '../../../shared/home-url.js'
import type { TaskManagerProcess, TaskManagerProcessKind, TaskManagerSubframe } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import type { Browser } from '../browser.js'
import { orderedTabs } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'

/** The tabs whose pages still run, in tab order. */
function tabsInOrder(browser: Browser): BrowserTab[] {
  return orderedTabs(browser).filter((tab) => !tab.webContents.isDestroyed())
}

interface PageProcess {
  tabIds: string[]
  subframes: TaskManagerSubframe[]
  devToolsTabIds: string[]
  /** Something here must not be ended: Hronaut's own window or Home, Developer Tools, or a page that sleeps or recovers. */
  keep: boolean
  interface: boolean
}

/**
 * How long after End process a page's exit counts as the person's. Electron reports it within milliseconds; a page
 * that left the process first, or a kill that never landed, must not have a later crash of its own called ended.
 */
export const ENDED_BY_PERSON_MS = 5_000

/**
 * The pages End process ended, each with when it asked on the monotonic clock, so only their exit soon after says the
 * person ended it, whatever the wall clock does.
 */
export class EndedByPersonMarks {
  private readonly noted = new WeakMap<WebContents, number>()

  constructor(private readonly now: () => number = () => performance.now()) {}

  note(contents: WebContents): void {
    this.noted.set(contents, this.now())
  }

  /** Whether the page's exit now is the one End process asked for; either way the mark goes. */
  take(contents: WebContents): boolean {
    const notedAt = this.noted.get(contents)
    this.noted.delete(contents)
    return notedAt !== undefined && this.now() - notedAt <= ENDED_BY_PERSON_MS
  }
}

/** Each process's place in the list when nothing sorts it: as Chrome lists them, the browser and its services first. */
const KIND_ORDER: Record<TaskManagerProcessKind, number> = { browser: 0, gpu: 1, utility: 2, interface: 3, page: 4, other: 5, helper: 6 }

/** The origin of a frame's address, as Chrome names a subframe by its site, or empty when the address has none. */
function frameSite(url: string): string {
  try {
    const origin = new URL(url).origin
    return origin === 'null' ? '' : origin
  } catch {
    return ''
  }
}

/** The process of each frame in a page, read while the page may be going; a frame that went is skipped. */
function framePids(contents: WebContents): Array<{ pid: number; url: string }> {
  try {
    return contents.mainFrame.framesInSubtree.flatMap((frame) => {
      try {
        return [{ pid: frame.osProcessId, url: frame.url }]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

/**
 * The page's process ID, or 0 when it has none, as while its renderer starts or after it exited. A page whose renderer
 * is gone can still name its old process for a moment, which Electron lists until it has exited; it runs nothing there.
 */
function processId(contents: WebContents): number {
  try {
    return contents.isDestroyed() || contents.isCrashed() ? 0 : contents.getOSProcessId()
  } catch {
    return 0
  }
}

/** The Developer Tools page a tab's page has open, if any. */
function devToolsOf(contents: WebContents): WebContents | undefined {
  try {
    const devTools = contents.devToolsWebContents
    return devTools && !devTools.isDestroyed() ? devTools : undefined
  } catch {
    return undefined
  }
}

function pageProcesses(browser: Browser): Map<number, PageProcess> {
  const pages = new Map<number, PageProcess>()
  const page = (pid: number): PageProcess => {
    let found = pages.get(pid)
    if (!found) pages.set(pid, found = { tabIds: [], subframes: [], devToolsTabIds: [], keep: false, interface: false })
    return found
  }
  const known = new Set<WebContents>()
  for (const tab of tabsInOrder(browser)) {
    const contents = tab.webContents
    known.add(contents)
    const pid = processId(contents)
    if (pid <= 0) continue
    const own = page(pid)
    own.tabIds.push(tab.id)
    let url = ''
    try { url = contents.getURL() } catch { /* the page went meanwhile */ }
    // Hronaut Home is Hronaut's own page, with its own access to Hronaut, even in a tab.
    if (tab.sleeping || tab.wakePromise !== undefined || browser.rendererRecovery.isRecovering(contents) || isHronautHomeUrl(url)) own.keep = true
    // With site isolation a frame of another site runs in a process of its own, as Chrome lists it as a subframe, each
    // site of a tab once however many frames it has there.
    for (const frame of framePids(contents)) {
      if (frame.pid <= 0 || frame.pid === pid) continue
      const site = frameSite(frame.url)
      const subframes = page(frame.pid).subframes
      if (!subframes.some((known) => known.tabId === tab.id && known.site === site)) subframes.push({ tabId: tab.id, site })
    }
    const devTools = devToolsOf(contents)
    if (devTools) {
      known.add(devTools)
      const devToolsPid = processId(devTools)
      if (devToolsPid > 0) {
        page(devToolsPid).devToolsTabIds.push(tab.id)
        page(devToolsPid).keep = true
      }
    }
  }
  for (const contents of electronWebContents.getAllWebContents()) {
    if (known.has(contents)) continue
    const pid = processId(contents)
    if (pid <= 0) continue
    const other = page(pid)
    other.keep = true
    let url = ''
    try { url = contents.getURL() } catch { /* the page went meanwhile */ }
    if (browser.options.isInterfacePage?.(url) === true) other.interface = true
  }
  return pages
}

/**
 * Every process of Hronaut's with its memory and CPU use, as Chrome's Task manager lists them: the browser process,
 * the GPU process, utility processes, Hronaut's own window, each process that runs tabs' pages, frames of other sites
 * or Developer Tools, and the rest. A page process can be ended when it runs a tab's page that is awake and nothing
 * of Hronaut's own; Developer Tools, Hronaut's window and Home stay, as does a page that sleeps, wakes or is being
 * replaced.
 */
export function taskManagerProcesses(browser: Browser): TaskManagerProcess[] {
  const pages = pageProcesses(browser)
  const processes = app.getAppMetrics().flatMap((metric): TaskManagerProcess[] => {
    if (!Number.isSafeInteger(metric.pid) || metric.pid <= 0) return []
    const page = pages.get(metric.pid)
    let kind: TaskManagerProcessKind
    let name: string | undefined
    if (metric.type === 'Browser') kind = 'browser'
    else if (metric.type === 'GPU') kind = 'gpu'
    else if (metric.type === 'Utility') {
      kind = 'utility'
      name = metric.name || metric.serviceName || undefined
    } else if (metric.type === 'Tab') {
      kind = page?.interface ? 'interface'
        : page && (page.tabIds.length > 0 || page.subframes.length > 0 || page.devToolsTabIds.length > 0) ? 'page'
          : 'other'
    } else {
      kind = 'helper'
      name = metric.type
    }
    const pageKind = kind === 'page'
    return [{
      pid: metric.pid,
      kind,
      ...(name ? { name } : {}),
      tabIds: pageKind ? [...page!.tabIds] : [],
      subframes: pageKind ? [...page!.subframes] : [],
      devToolsTabIds: pageKind ? [...page!.devToolsTabIds] : [],
      memoryBytes: Math.max(0, Math.round((metric.memory?.workingSetSize ?? 0) * 1024)),
      cpuPercent: Math.max(0, metric.cpu?.percentCPUUsage ?? 0),
      canEnd: pageKind && page!.tabIds.length > 0 && !page!.keep
    }]
  })
  const firstTab = new Map<string, number>()
  let index = 0
  for (const tab of tabsInOrder(browser)) firstTab.set(tab.id, index++)
  const tabOrder = (process: TaskManagerProcess): number => Math.min(
    ...[...process.tabIds, ...process.subframes.map((frame) => frame.tabId), ...process.devToolsTabIds].map((id) => firstTab.get(id) ?? index),
    index
  )
  return processes.sort((left, right) => (
    KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    || (left.kind === 'page' ? tabOrder(left) - tabOrder(right) : 0)
    || (left.name ?? '').localeCompare(right.name ?? '')
    || left.pid - right.pid
  ))
}

/**
 * Ends a page process the person chose in the Task manager, as Chrome's End process: every tab whose page runs there
 * shows that its page was ended, and reloading it starts a new process. Only a process the list lets end, read again
 * now, so a process ID that changed hands or never ran a tab's page is refused; Electron ends it through a page it
 * runs, never by its ID.
 */
export function endTaskManagerProcess(browser: Browser, pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new TypeError('Invalid process ID')
  const process = taskManagerProcesses(browser).find((candidate) => candidate.pid === pid)
  if (!process?.canEnd) throw new LocalizedError('appErrors.taskManager.cannotEnd', undefined, { message: `Process cannot be ended: ${pid}` })
  const pages = [...tabsInOrder(browser)].map((tab) => tab.webContents).filter((contents) => processId(contents) === pid)
  if (pages.length === 0) throw new LocalizedError('appErrors.taskManager.cannotEnd', undefined, { message: `Process cannot be ended: ${pid}` })
  for (const contents of pages) browser.endedByPerson.note(contents)
  pages[0]!.forcefullyCrashRenderer()
}

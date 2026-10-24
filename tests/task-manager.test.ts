import { describe, expect, it, vi } from 'vitest'
import type { ProcessMetric, WebContents } from 'electron'
import { LocalizedError } from '../src/main/localized-error.js'
import { ENDED_BY_PERSON_MS, EndedByPersonMarks, endTaskManagerProcess, taskManagerProcesses, type TaskManagerAccess, type TaskManagerTab } from '../src/main/browser/task-manager/task-manager.js'

interface FakePage {
  pid: number
  url?: string
  frames?: Array<{ pid: number; url: string } | 'gone'>
  devTools?: FakePage
  destroyed?: boolean
  crashed?: boolean
}

function contents(page: FakePage): WebContents {
  const self = {
    isDestroyed: () => page.destroyed === true,
    isCrashed: () => page.crashed === true,
    getOSProcessId: () => page.pid,
    getURL: () => page.url ?? 'https://example.com/',
    forcefullyCrashRenderer: vi.fn(),
    get devToolsWebContents() { return page.devTools ? contents(page.devTools) : null },
    mainFrame: {
      framesInSubtree: [
        { osProcessId: page.pid, url: page.url ?? 'https://example.com/' },
        ...(page.frames ?? []).map((frame) => frame === 'gone'
          ? Object.defineProperty({}, 'osProcessId', { get: () => { throw new Error('Render frame was disposed') } })
          : { osProcessId: frame.pid, url: frame.url })
      ]
    }
  }
  return self as unknown as WebContents
}

function metric(pid: number, type: ProcessMetric['type'], extra: Partial<ProcessMetric> = {}, kilobytes = 1000, cpu = 0): ProcessMetric {
  return { pid, type, creationTime: 0, sandboxed: true, cpu: { percentCPUUsage: cpu, idleWakeupsPerSecond: 0 }, memory: { workingSetSize: kilobytes, peakWorkingSetSize: kilobytes }, ...extra } as ProcessMetric
}

function harness(options: { tabs: Array<TaskManagerTab>; metrics: ProcessMetric[]; others?: WebContents[]; recovering?: WebContents[] }) {
  const ended: WebContents[] = []
  const access: TaskManagerAccess<TaskManagerTab> = {
    tabs: () => options.tabs,
    appMetrics: () => options.metrics,
    allWebContents: () => [...options.tabs.map((tab) => tab.webContents), ...(options.others ?? [])],
    isInterfacePage: (url) => url.startsWith('file:///app/renderer/'),
    rendererRecovering: (page) => options.recovering?.includes(page) === true,
    noteEndedByPerson: (page) => { ended.push(page) }
  }
  return { access, ended }
}

function tab(id: string, page: FakePage, state: Partial<TaskManagerTab> = {}): TaskManagerTab {
  return { id, webContents: contents(page), sleeping: false, ...state }
}

describe('the Task manager\'s processes', () => {
  it('lists each process as Chrome does, the browser and its services first, and the tabs in tab order', () => {
    const shell = contents({ pid: 40, url: 'file:///app/renderer/index.html' })
    const spare = contents({ pid: 60, url: 'about:blank' })
    const { access } = harness({
      tabs: [
        tab('second', { pid: 52, url: 'https://second.example/' }),
        tab('first', { pid: 51, url: 'https://first.example/', frames: [{ pid: 53, url: 'https://ads.example/frame?id=1#x' }, { pid: 51, url: 'https://first.example/same' }, { pid: 53, url: 'https://ads.example/frame?id=2' }] }),
        tab('shared', { pid: 52, url: 'https://second.example/other' })
      ],
      others: [shell, spare],
      metrics: [
        metric(53, 'Tab'), metric(52, 'Tab', {}, 3000, 12.5), metric(51, 'Tab'), metric(60, 'Tab'), metric(40, 'Tab'),
        metric(30, 'Utility', { name: 'Network Service', serviceName: 'network.mojom.NetworkService' }),
        metric(31, 'Utility', { serviceName: 'storage.mojom.StorageService' }),
        metric(20, 'GPU'), metric(10, 'Browser'), metric(70, 'Zygote'), metric(0, 'Tab')
      ]
    })

    const processes = taskManagerProcesses(access)

    expect(processes.map(({ pid, kind, name }) => ({ pid, kind, name }))).toEqual([
      { pid: 10, kind: 'browser', name: undefined },
      { pid: 20, kind: 'gpu', name: undefined },
      { pid: 30, kind: 'utility', name: 'Network Service' },
      { pid: 31, kind: 'utility', name: 'storage.mojom.StorageService' },
      { pid: 40, kind: 'interface', name: undefined },
      // The first tab in tab order runs in 52, and the next one's subframe in 53.
      { pid: 52, kind: 'page', name: undefined },
      { pid: 51, kind: 'page', name: undefined },
      { pid: 53, kind: 'page', name: undefined },
      { pid: 60, kind: 'other', name: undefined },
      { pid: 70, kind: 'helper', name: 'Zygote' }
    ])
    const shared = processes.find((process) => process.pid === 52)!
    expect(shared).toEqual({ pid: 52, kind: 'page', tabIds: ['second', 'shared'], subframes: [], devToolsTabIds: [], memoryBytes: 3000 * 1024, cpuPercent: 12.5, canEnd: true })
    // A frame of another site names only its origin, never its path, query or fragment, and a tab's site once.
    expect(processes.find((process) => process.pid === 53)).toMatchObject({ tabIds: [], subframes: [{ tabId: 'first', site: 'https://ads.example' }], canEnd: false })
    expect(processes.filter((process) => process.canEnd).map((process) => process.pid)).toEqual([52, 51])
  })

  it('keeps Hronaut\'s window and Home, Developer Tools and a tab that sleeps, wakes or is being replaced from End process', () => {
    const recovering = { pid: 84 }
    const recoveringTab = tab('recovering', recovering)
    const { access } = harness({
      tabs: [
        tab('sleeping', { pid: 81 }, { sleeping: true }),
        tab('waking', { pid: 82 }, { wakePromise: Promise.resolve() }),
        tab('inspected', { pid: 83, devTools: { pid: 90, url: 'devtools://devtools/bundled/devtools_app.html' } }),
        recoveringTab,
        tab('awake', { pid: 85 }),
        tab('home', { pid: 86, url: 'hronaut://home/' })
      ],
      recovering: [recoveringTab.webContents],
      others: [contents({ pid: 85, url: 'file:///app/renderer/agent-card.html' })],
      metrics: [81, 82, 83, 84, 85, 86, 90].map((pid) => metric(pid, 'Tab'))
    })

    const processes = taskManagerProcesses(access)

    expect(Object.fromEntries(processes.map((process) => [process.pid, [process.kind, process.canEnd]]))).toEqual({
      81: ['page', false],
      82: ['page', false],
      // The tab's own page can be ended; its Developer Tools cannot.
      83: ['page', true],
      84: ['page', false],
      // A process Hronaut's own page shares is Hronaut's.
      85: ['interface', false],
      // Hronaut Home in a tab is the tab's, and Hronaut's own page.
      86: ['page', false],
      90: ['page', false]
    })
    expect(processes.find((process) => process.pid === 86)).toMatchObject({ tabIds: ['home'] })
    expect(processes.find((process) => process.pid === 90)).toMatchObject({ tabIds: [], devToolsTabIds: ['inspected'] })
  })

  it('skips frames and pages that went while it read them', () => {
    const { access } = harness({
      tabs: [
        tab('closing', { pid: 91, frames: ['gone', { pid: 92, url: 'data:text/html,frame' }] }),
        tab('closed', { pid: 93, destroyed: true }),
        // Its renderer is gone, though Electron still lists the process as it exits.
        tab('ended', { pid: 94, crashed: true })
      ],
      metrics: [metric(91, 'Tab'), metric(92, 'Tab'), metric(93, 'Tab'), metric(94, 'Tab')]
    })

    const processes = taskManagerProcesses(access)

    expect(processes.find((process) => process.pid === 91)).toMatchObject({ kind: 'page', tabIds: ['closing'], canEnd: true })
    // A frame whose address has no origin is a subframe without a site.
    expect(processes.find((process) => process.pid === 92)).toMatchObject({ kind: 'page', subframes: [{ tabId: 'closing', site: '' }] })
    expect(processes.find((process) => process.pid === 93)).toMatchObject({ kind: 'other', tabIds: [], canEnd: false })
    expect(processes.find((process) => process.pid === 94)).toMatchObject({ kind: 'other', tabIds: [], canEnd: false })
    expect(() => endTaskManagerProcess(access, 94)).toThrow('Process cannot be ended: 94')
  })
})

describe('End process', () => {
  it('ends the process through a page it runs and notes every tab there as ended by the person', () => {
    const tabs = [tab('one', { pid: 51 }), tab('two', { pid: 51 }), tab('other', { pid: 52 })]
    const { access, ended } = harness({ tabs, metrics: [metric(51, 'Tab'), metric(52, 'Tab')] })

    endTaskManagerProcess(access, 51)

    expect(ended).toEqual([tabs[0]!.webContents, tabs[1]!.webContents])
    expect(tabs[0]!.webContents.forcefullyCrashRenderer).toHaveBeenCalledOnce()
    expect(tabs[1]!.webContents.forcefullyCrashRenderer).not.toHaveBeenCalled()
    expect(tabs[2]!.webContents.forcefullyCrashRenderer).not.toHaveBeenCalled()
  })

  it('refuses a process the list does not let end, read again now', () => {
    const shell = contents({ pid: 40, url: 'file:///app/renderer/index.html' })
    const sleeping = tab('sleeping', { pid: 81 }, { sleeping: true })
    const { access, ended } = harness({
      tabs: [sleeping],
      others: [shell],
      metrics: [metric(10, 'Browser'), metric(40, 'Tab'), metric(81, 'Tab')]
    })

    for (const pid of [10, 40, 81, 12345]) {
      expect(() => endTaskManagerProcess(access, pid), String(pid)).toThrow(LocalizedError)
      expect(() => endTaskManagerProcess(access, pid)).toThrow(`Process cannot be ended: ${pid}`)
    }
    for (const pid of [0, -1, 1.5, Number.NaN]) expect(() => endTaskManagerProcess(access, pid)).toThrow(TypeError)
    expect(ended).toEqual([])
    expect(shell.forcefullyCrashRenderer).not.toHaveBeenCalled()
    expect(sleeping.webContents.forcefullyCrashRenderer).not.toHaveBeenCalled()
  })

  it('says the person ended a page only for its exit soon after End process, once', () => {
    let now = 1_000
    const marks = new EndedByPersonMarks(() => now)
    const ended = contents({ pid: 51 })
    const late = contents({ pid: 52 })
    const never = contents({ pid: 53 })
    marks.note(ended)
    marks.note(late)
    now += 20
    expect(marks.take(ended)).toBe(true)
    // Its next exit, such as a crash after Try again, is its own.
    expect(marks.take(ended)).toBe(false)
    // A page that left the process, or a kill that never landed, has its later crash called a crash.
    now += ENDED_BY_PERSON_MS
    expect(marks.take(late)).toBe(false)
    expect(marks.take(never)).toBe(false)
  })

  it('names its refusal for the person', () => {
    const { access } = harness({ tabs: [], metrics: [metric(10, 'Browser')] })
    let refusal: unknown
    try { endTaskManagerProcess(access, 10) } catch (error) { refusal = error }
    expect(refusal).toBeInstanceOf(LocalizedError)
    expect((refusal as LocalizedError).key).toBe('appErrors.taskManager.cannotEnd')
  })
})

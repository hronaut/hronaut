import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dropFiles } from '../src/main/browser/file-drop/file-drop.js'
import type { FileDropAccess, FileDropTab } from '../src/main/browser/file-drop/file-drop-access.js'
import type { FileDropLocation, FileDropObservation } from '../src/main/browser/file-drop/file-drop-scripts.js'
import { ISOLATED_WORLDS } from '../src/main/browser/isolated-worlds.js'

type Command = { type: string; x: number; y: number; files?: string[]; validated: boolean }

const observation = (overrides: Partial<FileDropObservation> = {}): FileDropObservation => ({
  current: true, dragOverArrived: false, dragOverAccepted: false, dropSeen: false, dropHandled: false, leftWithoutDrop: false, ...overrides
})

/**
 * A page whose isolated-world scripts answer from queues, and a manager view whose
 * authorized debugger records each drag command and checks the drop's authority first.
 */
function dropPage(options: {
  locations?: FileDropLocation[]
  observations?: Partial<Record<'enter' | 'over' | 'drop', Array<Partial<FileDropObservation> | Error>>>
  /** Runs after a command passed its checks and was recorded; what it returns or throws is Chromium's answer. */
  onCommand?: (command: Command) => unknown
} = {}) {
  const commands: Command[] = []
  const scripts: Array<{ world: number; kind: string }> = []
  const locations = [...(options.locations ?? [{ x: 120, y: 80 }, { x: 120, y: 80 }])]
  const observations = {
    enter: [...(options.observations?.enter ?? [{}])],
    over: [...(options.observations?.over ?? [{ dragOverArrived: true, dragOverAccepted: true }])],
    drop: [...(options.observations?.drop ?? [{ dropSeen: true, dropHandled: true }])]
  }
  const webContents = {
    executeJavaScriptInIsolatedWorld: async (world: number, sources: Array<{ code: string }>) => {
      const code = sources[0]?.code ?? ''
      if (code.includes('querySelectorAll')) {
        scripts.push({ world, kind: code.includes('const install = true') ? 'locate' : 'relocate' })
        return locations.shift() ?? { problem: 'replaced' }
      }
      const phase = /const phase = "(enter|over|drop)"/.exec(code)?.[1] as 'enter' | 'over' | 'drop' | undefined
      if (phase) {
        scripts.push({ world, kind: phase })
        const next = observations[phase].shift() ?? {}
        if (next instanceof Error) throw next
        return observation(next)
      }
      scripts.push({ world, kind: 'dispose' })
      return true
    }
  }
  const tab: FileDropTab = { webContents: webContents as never }
  let authorityCurrent = true
  let disposed = 0
  const pointers: Array<{ x: number; y: number }> = []
  const access: FileDropAccess<FileDropTab> = {
    validateTarget: (target) => {
      if (!target.ref && !target.selector) throw new Error('Provide ref or selector')
    },
    getTab: () => tab,
    nativeInputAuthority: () => ({
      validate: () => { if (!authorityCurrent) throw new Error('Native input context changed') },
      dispose: () => { disposed += 1 }
    }),
    showAgentPointer: async (_webContents, point) => { pointers.push(point) },
    withAgentInput: (_webContents, operation) => operation(),
    withDebugger: (_webContents, operation) => operation(),
    agentInputDebugger: (_webContents, validateInput) => ({
      sendCommand: async (method, params = {}) => {
        expect(method).toBe('Input.dispatchDragEvent')
        validateInput?.()
        const data = params.data as { files?: string[] }
        const command = { type: String(params.type), x: Number(params.x), y: Number(params.y), files: data.files, validated: Boolean(validateInput) }
        commands.push(command)
        return (await options.onCommand?.(command)) ?? {}
      }
    })
  }
  return {
    access,
    commands,
    scripts,
    pointers,
    disposed: () => disposed,
    loseAuthority: () => { authorityCurrent = false }
  }
}

describe('file drop', () => {
  let folder: string
  let notes: string
  let data: string

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'hronaut-file-drop-'))
    notes = join(folder, 'notes.txt')
    data = join(folder, 'data.csv')
    await writeFile(notes, 'notes')
    await writeFile(data, 'a,b')
    await mkdir(join(folder, 'directory'))
  })

  afterEach(async () => {
    vi.useRealTimers()
    await rm(folder, { recursive: true, force: true })
  })

  it('enters, accepts and drops the files at the target, and returns only their count', async () => {
    const page = dropPage()
    const result = await dropFiles(page.access, { selector: '#zone' }, [notes, data])
    expect(result).toMatchObject({ status: 'DROPPED', files: 2, pageHandledDrop: true })
    expect(JSON.stringify(result)).not.toContain(folder)
    expect(page.commands).toEqual([
      { type: 'dragEnter', x: 120, y: 80, files: [notes, data], validated: true },
      { type: 'dragOver', x: 120, y: 80, files: [notes, data], validated: true },
      { type: 'drop', x: 120, y: 80, files: [notes, data], validated: true }
    ])
    expect(page.pointers).toEqual([{ x: 120, y: 80 }])
    expect(page.scripts.map(script => script.kind)).toEqual(['locate', 'relocate', 'enter', 'over', 'drop', 'dispose'])
    expect(page.scripts.every(script => script.world === ISOLATED_WORLDS.fileDrop)).toBe(true)
    expect(page.disposed()).toBe(1)
  })

  it('keeps updating the drag while it only moves onto a new element, such as an overlay shown on dragenter', async () => {
    const page = dropPage({ observations: { over: [{}, { dragOverArrived: true, dragOverAccepted: true }] } })
    const result = await dropFiles(page.access, { selector: '#attach' }, [notes])
    expect(result.status).toBe('DROPPED')
    expect(page.commands.map(command => command.type)).toEqual(['dragEnter', 'dragOver', 'dragOver', 'drop'])
  })

  it('leaves the page without dropping when no dragover accepts the files', async () => {
    const page = dropPage({ observations: { over: [{ dragOverArrived: true, dragOverAccepted: false }] } })
    const result = await dropFiles(page.access, { selector: '#zone' }, [notes])
    expect(result).toMatchObject({ status: 'NOT_ACCEPTED', files: 1 })
    expect(result.note).toContain('browser_file_upload')
    expect(page.commands).toEqual([
      { type: 'dragEnter', x: 120, y: 80, files: [notes], validated: true },
      { type: 'dragOver', x: 120, y: 80, files: [notes], validated: true },
      { type: 'dragOver', x: -100, y: -100, files: undefined, validated: false },
      { type: 'drop', x: -100, y: -100, files: undefined, validated: false }
    ])
  })

  it('treats a target that never gets a dragover after four updates as not accepting the files', async () => {
    const page = dropPage({ observations: { over: [{}, {}, {}, {}] } })
    const result = await dropFiles(page.access, { selector: '#zone' }, [notes])
    expect(result.status).toBe('NOT_ACCEPTED')
    expect(page.commands.filter(command => command.files).map(command => command.type)).toEqual(['dragEnter', 'dragOver', 'dragOver', 'dragOver', 'dragOver'])
    expect(page.commands.some(command => command.type === 'drop' && command.files)).toBe(false)
  })

  it('reports a drop Chromium ended with a dragleave as not accepted, and an unseen drop as unconfirmed', async () => {
    const refused = dropPage({ observations: { drop: [{ leftWithoutDrop: true }] } })
    expect(await dropFiles(refused.access, { selector: '#zone' }, [notes])).toMatchObject({ status: 'NOT_ACCEPTED', files: 1 })
    expect(refused.commands.at(-1)).toMatchObject({ type: 'drop', x: 120, y: 80 })
    const unseen = dropPage({ observations: { drop: [{}] } })
    const result = await dropFiles(unseen.access, { selector: '#zone' }, [notes])
    expect(result).toMatchObject({ status: 'DROP_UNCONFIRMED', files: 1 })
    expect(result).not.toHaveProperty('pageHandledDrop')
  })

  it('stops before the drop when its authority ends during the drag, and leaves the page without the files', async () => {
    const pageRef: { current?: ReturnType<typeof dropPage> } = {}
    const page = dropPage({ onCommand: (command) => { if (command.type === 'dragOver' && command.files) pageRef.current?.loseAuthority() } })
    pageRef.current = page
    await expect(dropFiles(page.access, { selector: '#zone' }, [notes])).rejects.toThrow('Native input context changed')
    expect(page.commands).toEqual([
      { type: 'dragEnter', x: 120, y: 80, files: [notes], validated: true },
      { type: 'dragOver', x: 120, y: 80, files: [notes], validated: true },
      { type: 'dragOver', x: -100, y: -100, files: undefined, validated: false },
      { type: 'drop', x: -100, y: -100, files: undefined, validated: false }
    ])
    expect(page.disposed()).toBe(1)
  })

  it('reports a drop Chromium rejects after its checks passed as unconfirmed, since it may have reached the page', async () => {
    const page = dropPage({ onCommand: (command) => { if (command.type === 'drop' && command.files) throw new Error('Target closed') } })
    const result = await dropFiles(page.access, { selector: '#zone' }, [notes])
    expect(result).toMatchObject({ status: 'DROP_UNCONFIRMED', files: 1 })
    expect(result.note).toContain('may have reached the page')
    expect(page.commands.slice(-2)).toMatchObject([{ type: 'dragOver', x: -100, y: -100, files: undefined }, { type: 'drop', x: -100, y: -100, files: undefined }])
  })

  it('gives up on a drag event Chromium does not answer: before the drop it stops and leaves, at the drop it is unconfirmed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let reached!: () => void
    const reachedDragOver = new Promise<void>((resolve) => { reached = resolve })
    const stalledOver = dropPage({
      onCommand: (command) => {
        if (command.type !== 'dragOver' || !command.files) return undefined
        reached()
        return new Promise(() => undefined)
      }
    })
    const stopped = dropFiles(stalledOver.access, { selector: '#zone' }, [notes]).then(() => undefined, (error: unknown) => error as Error)
    await reachedDragOver
    await vi.advanceTimersByTimeAsync(5_000)
    expect((await stopped)?.message).toMatch(/did not take the drag event in time/)
    expect(stalledOver.commands.map(command => [command.type, command.files ? 'files' : 'none'])).toEqual([
      ['dragEnter', 'files'], ['dragOver', 'files'], ['dragOver', 'none'], ['drop', 'none']
    ])

    let reachedDrop!: () => void
    const dropReached = new Promise<void>((resolve) => { reachedDrop = resolve })
    const stalledDrop = dropPage({
      onCommand: (command) => {
        if (command.type !== 'drop' || !command.files) return undefined
        reachedDrop()
        return new Promise(() => undefined)
      }
    })
    const unconfirmed = dropFiles(stalledDrop.access, { selector: '#zone' }, [notes])
    await dropReached
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await unconfirmed).toMatchObject({ status: 'DROP_UNCONFIRMED', files: 1 })
  })

  it('stops when the page stops answering during the drag', async () => {
    const page = dropPage({ observations: { over: [new Error('Script failed to execute')] } })
    await expect(dropFiles(page.access, { selector: '#zone' }, [notes])).rejects.toThrow('stopped answering')
    expect(page.commands.map(command => command.type)).toEqual(['dragEnter', 'dragOver', 'dragOver', 'drop'])
    expect(page.commands.at(-1)).toMatchObject({ x: -100, y: -100, files: undefined })
  })

  it('refuses targets the page cannot take a drop on before any drag event', async () => {
    const messages: Array<[FileDropLocation, RegExp]> = [
      [{ problem: 'invalid-selector' }, /not valid CSS/],
      [{ problem: 'not-found' }, /not found/],
      [{ problem: 'ambiguous', count: 2 }, /more than one element/],
      [{ problem: 'frame' }, /frame is not supported/],
      [{ problem: 'pinch-zoom' }, /pinch-zoomed/],
      [{ problem: 'hidden' }, /hidden or has no size/],
      [{ problem: 'outside' }, /viewport/],
      [{ problem: 'covered' }, /covers the center/]
    ]
    for (const [location, message] of messages) {
      const page = dropPage({ locations: [location] })
      await expect(dropFiles(page.access, { selector: '#zone' }, [notes])).rejects.toThrow(message)
      expect(page.commands).toEqual([])
      expect(page.pointers).toEqual([])
    }
    const replaced = dropPage({ locations: [{ x: 120, y: 80 }, { problem: 'replaced' }] })
    await expect(dropFiles(replaced.access, { selector: '#zone' }, [notes])).rejects.toThrow(/changed before the drop/)
    expect(replaced.commands).toEqual([])
  })

  it('refuses unusable paths before reaching the page, naming them only by position', async () => {
    const cases: Array<[string[], RegExp]> = [
      [[], /between 1 and 20/],
      [Array.from({ length: 21 }, () => notes), /between 1 and 20/],
      [[notes, notes], /only once/],
      [['relative.txt'], /File path 1 must be absolute/],
      [[notes, join(folder, 'directory')], /File path 2 is not a file/],
      [[join(folder, 'missing.txt')], /File path 1 cannot be read/]
    ]
    for (const [paths, message] of cases) {
      const page = dropPage()
      const failure = await dropFiles(page.access, { selector: '#zone' }, paths).then(() => undefined, (error: unknown) => error as Error)
      expect(failure?.message).toMatch(message)
      expect(failure?.message).not.toContain(folder)
      expect(page.scripts).toEqual([])
      expect(page.commands).toEqual([])
    }
  })
})

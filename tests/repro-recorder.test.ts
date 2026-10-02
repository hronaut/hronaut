import type { Input, WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserReproRecorder, type BrowserReproRecordingInternal } from '../src/main/browser/repro-recorder.js'
import { reproScrollScript } from '../src/main/browser/repro-page-scripts.js'

const enterKey: Input = {
  type: 'keyDown', key: 'Enter', code: 'Enter', isAutoRepeat: false,
  isComposing: false, shift: false, control: false, alt: false, meta: false,
  location: 0, modifiers: []
}

function fixture() {
  const executeJavaScript = vi.fn(async (script: string): Promise<unknown> => script === reproScrollScript()
    ? { x: 0, y: 0 }
    : { selector: 'main > button', tag: 'button', label: 'Continue' })
  const tab = {
    id: 'recording-tab', title: 'Recorder fixture', url: 'https://example.test/',
    navigationGeneration: 1, observationGeneration: 1,
    webContents: { executeJavaScript, isDestroyed: () => false } as unknown as WebContents,
    view: { getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }) },
    reproRecording: undefined as BrowserReproRecordingInternal | undefined
  }
  const changed = vi.fn()
  const isAgentInput = vi.fn(() => false)
  const recorder = new BrowserReproRecorder({ isCurrent: candidate => candidate === tab, isAgentInput, changed })
  return { tab, recorder, executeJavaScript, changed, isAgentInput }
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('reproduction recorder data contracts', () => {
  it.each(['queued', 'in-flight'] as const)('retains a target-free review step for %s actions invalidated by navigation', async phase => {
    const f = fixture()
    await f.recorder.manage(f.tab, 'start')
    let release!: (value: unknown) => void
    const held = new Promise(resolve => { release = resolve })
    f.executeJavaScript.mockReturnValueOnce(held)
    f.recorder.observeReproKeyboard(f.tab, enterKey)
    if (phase === 'in-flight') await Promise.resolve().then(() => undefined)
    f.tab.navigationGeneration++
    f.recorder.navigated(f.tab, f.tab.url, false)
    release({ selector: 'private-target', tag: 'input', label: 'Obsolete label' })
    const report = await f.recorder.manage(f.tab, 'stop')
    expect(report.steps.at(-1)).toMatchObject({ kind: 'key', description: expect.stringContaining('navigation') })
    expect(report.steps.at(-1)).not.toHaveProperty('target')
    expect(report.steps.at(-1)).not.toHaveProperty('key')
    expect(JSON.stringify(report)).not.toMatch(/private-target|Obsolete label/)
  })

  it('does not carry an invalidated action into a replacement recording', async () => {
    const f = fixture()
    await f.recorder.manage(f.tab, 'start')
    let release!: (value: unknown) => void
    f.executeJavaScript.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
    f.recorder.observeReproKeyboard(f.tab, enterKey)
    await Promise.resolve().then(() => undefined)
    const previousQueue = f.tab.reproRecording!.queue
    f.tab.navigationGeneration++
    await f.recorder.manage(f.tab, 'start')
    release({ selector: 'old', tag: 'button' })
    await previousQueue
    expect((await f.recorder.manage(f.tab, 'stop')).steps.map(step => step.kind)).toEqual(['navigate'])
  })

  it.each(['checkbox', 'radio'])('records Space activation on a native %s as a key without a replacement value', async (inputType) => {
    const f = fixture()
    await f.recorder.manage(f.tab, 'start')
    f.executeJavaScript.mockResolvedValue({ selector: 'input', tag: 'input', inputType })
    f.recorder.observeReproKeyboard(f.tab, { ...enterKey, key: ' ', code: 'Space' })
    await f.tab.reproRecording!.queue
    const report = await f.recorder.manage(f.tab, 'stop')
    expect(report.steps[1]).toMatchObject({ kind: 'key', key: 'Space', target: { inputType } })
    expect(report.steps[1]).not.toHaveProperty('valueRedacted')
    f.recorder.clearReproRecording(f.tab)
  })

  it.each(['text', 'password'])('keeps Space in a %s input redacted', async (inputType) => {
    const f = fixture()
    await f.recorder.manage(f.tab, 'start')
    f.executeJavaScript.mockResolvedValue({ selector: 'input', tag: 'input', inputType })
    f.recorder.observeReproKeyboard(f.tab, { ...enterKey, key: ' ', code: 'Space' })
    await f.tab.reproRecording!.queue
    const report = await f.recorder.manage(f.tab, 'stop')
    expect(report.steps[1]).toMatchObject({ kind: 'input', valueRedacted: true })
    expect(report.steps[1]).not.toHaveProperty('key')
    f.recorder.clearReproRecording(f.tab)
  })

  it('discards a delayed scroll from the previous document and records new-page scrolling', async () => {
    vi.useFakeTimers()
    const f = fixture()
    try {
      await f.recorder.manage(f.tab, 'start')
      f.executeJavaScript.mockClear()
      f.executeJavaScript.mockResolvedValue({ x: 0, y: 300 })
      f.recorder.observeReproMouse(f.tab, { type: 'mouseWheel', x: 10, y: 10 })
      f.tab.navigationGeneration += 1
      f.tab.url = 'https://example.test/next'
      f.recorder.navigated(f.tab, f.tab.url, false)
      await vi.advanceTimersByTimeAsync(250)
      await f.tab.reproRecording!.queue
      expect(f.executeJavaScript).not.toHaveBeenCalled()
      expect((await f.recorder.manage(f.tab, 'get')).steps.map(step => step.kind)).toEqual(['navigate', 'navigate'])

      f.recorder.observeReproMouse(f.tab, { type: 'mouseWheel', x: 10, y: 10 })
      await vi.advanceTimersByTimeAsync(250)
      await f.tab.reproRecording!.queue
      expect((await f.recorder.manage(f.tab, 'get')).steps.at(-1)).toMatchObject({ kind: 'scroll', scroll: { x: 0, y: 300 } })
    } finally {
      f.recorder.clearReproRecording(f.tab)
    }
  })

  it('retains unresolved input targets without merging separate edits', async () => {
    const f = fixture()
    await f.recorder.manage(f.tab, 'start')
    f.executeJavaScript.mockResolvedValue({ selector: '', tag: 'input', label: 'Unresolved field' })
    for (let index = 0; index < 2; index++) {
      f.recorder.observeReproKeyboard(f.tab, { ...enterKey, key: 'a', code: 'KeyA' })
      await f.tab.reproRecording!.queue
    }
    const report = await f.recorder.manage(f.tab, 'stop')
    expect(report.steps.slice(1)).toMatchObject([
      { kind: 'input', target: { selector: '', tag: 'input' } },
      { kind: 'input', target: { selector: '', tag: 'input' } }
    ])
  })

  it('returns independent timeline and target snapshots', async () => {
    const f = fixture()
    await f.recorder.manage(f.tab, 'start')
    f.recorder.observeReproKeyboard(f.tab, enterKey)
    await f.tab.reproRecording!.queue
    const snapshot = await f.recorder.manage(f.tab, 'get')
    expect(snapshot.steps[1]!.target).toMatchObject({ selector: 'main > button', label: 'Continue' })
    snapshot.steps[1]!.target!.selector = 'wrong-target'
    snapshot.steps[0]!.description = 'changed by consumer'
    snapshot.steps.splice(0, 1)
    const next = await f.recorder.manage(f.tab, 'get')
    expect(next.stepCount).toBe(2)
    expect(next.steps[0]!.description).toBe('Open https://example.test/')
    expect(next.steps[1]!.target!.selector).toBe('main > button')
    f.recorder.clearReproRecording(f.tab)
    expect(next.steps).toHaveLength(2)
    expect((await f.recorder.manage(f.tab, 'get')).steps).toEqual([])
  })

  it('bounds the timeline and distinguishes reaching the limit from dropping a step', async () => {
    const f = fixture()
    await f.recorder.manage(f.tab, 'start')
    for (let index = 1; index < 200; index++) f.recorder.navigated(f.tab, `https://example.test/${index}`, false)
    expect(await f.recorder.manage(f.tab, 'get')).toMatchObject({ stepCount: 200, truncated: false })
    f.recorder.navigated(f.tab, 'https://example.test/overflow', false)
    const full = await f.recorder.manage(f.tab, 'stop')
    expect(full).toMatchObject({ active: false, stepCount: 200, truncated: true })
    expect(full.steps.at(-1)!.description).toBe('Navigate to https://example.test/199')
    const restarted = await f.recorder.manage(f.tab, 'start')
    expect(restarted).toMatchObject({ active: true, stepCount: 1, truncated: false })
    f.recorder.clearReproRecording(f.tab)
  })

  it('does not record agent keyboard or pointer input as human interaction', async () => {
    const f = fixture()
    await f.recorder.manage(f.tab, 'start')
    f.executeJavaScript.mockClear()
    f.isAgentInput.mockReturnValue(true)
    f.recorder.observeReproKeyboard(f.tab, enterKey)
    f.recorder.observeReproMouse(f.tab, { type: 'mouseDown', x: 10, y: 10, button: 'left' })
    f.recorder.observeReproMouse(f.tab, { type: 'mouseUp', x: 10, y: 10, button: 'left' })
    const stopped = await f.recorder.manage(f.tab, 'stop')
    expect(stopped).toMatchObject({ active: false, stepCount: 1 })
    expect(f.executeJavaScript).not.toHaveBeenCalled()
  })

  it.each([-60_000, 60_000])('keeps elapsed time independent of a %i ms wall-clock adjustment', async (adjustment) => {
    let wallTime = 100_000
    let elapsedTime = 100
    vi.spyOn(Date, 'now').mockImplementation(() => wallTime)
    vi.spyOn(performance, 'now').mockImplementation(() => elapsedTime)
    const f = fixture()
    await f.recorder.manage(f.tab, 'start')
    wallTime += adjustment
    elapsedTime += 500
    f.recorder.navigated(f.tab, 'https://example.test/next', false)
    const report = await f.recorder.manage(f.tab, 'stop')
    expect(report.steps.at(-1)!.elapsedMs).toBe(500)
    expect(report.steps.at(-1)!.occurredAt).toBe(new Date(wallTime).toISOString())
  })

  it.each([
    { gap: 1000, clockChange: 60_000, steps: 2 },
    { gap: 2000, clockChange: -60_000, steps: 3 }
  ])('coalesces typing by elapsed time with a $clockChange ms clock change', async ({ gap, clockChange, steps }) => {
    let wallTime = 100_000
    let elapsedTime = 100
    vi.spyOn(Date, 'now').mockImplementation(() => wallTime)
    vi.spyOn(performance, 'now').mockImplementation(() => elapsedTime)
    const f = fixture()
    await f.recorder.manage(f.tab, 'start')
    f.recorder.observeReproKeyboard(f.tab, { ...enterKey, key: 'a', code: 'KeyA' })
    await f.tab.reproRecording!.queue
    wallTime += clockChange
    elapsedTime += gap
    f.recorder.observeReproKeyboard(f.tab, { ...enterKey, key: 'b', code: 'KeyB' })
    await f.tab.reproRecording!.queue
    const report = await f.recorder.manage(f.tab, 'stop')
    expect(report.stepCount).toBe(steps)
    expect(report.steps.at(-1)!.elapsedMs).toBe(gap)
  })

})

describe('Repro checkpoint authority', () => {
  it('records explicit failed expectations and returns independent values', async () => {
    const f = fixture()
    const report = await f.recorder.manage(f.tab, 'start')
    f.executeJavaScript.mockResolvedValue({ selector: 'p', tag: 'p', observedMatch: false } as never)
    const result = await f.recorder.manage(f.tab, 'checkpoint', { context: report.checkpointContext, selector: '#result', condition: 'text', text: 'Saved', reviewed: true })
    expect(result.steps.at(-1)).toMatchObject({ kind: 'expect', expectation: { text: 'Saved', observedMatch: false } })
    result.steps.at(-1)!.expectation!.text = 'mutated'
    expect((await f.recorder.manage(f.tab, 'get')).steps.at(-1)!.expectation!.text).toBe('Saved')
  })
  it.each(['navigationGeneration', 'observationGeneration'] as const)('rejects stale %s before page evaluation', async generation => {
    const f = fixture()
    const report = await f.recorder.manage(f.tab, 'start')
    f.executeJavaScript.mockClear()
    f.tab[generation] += 1
    await expect(f.recorder.manage(f.tab, 'checkpoint', { context: report.checkpointContext, selector: 'p', condition: 'visible', reviewed: true })).rejects.toThrow('context changed')
    expect(f.executeJavaScript).not.toHaveBeenCalled()
  })
  it('rejects a late checkpoint after recording replacement', async () => {
    const f = fixture()
    const report = await f.recorder.manage(f.tab, 'start')
    let finish!: (value: never) => void
    f.executeJavaScript.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = f.recorder.manage(f.tab, 'checkpoint', { context: report.checkpointContext, selector: 'p', condition: 'visible', reviewed: true })
    const rejected = expect(pending).rejects.toThrow('context changed')
    await vi.waitFor(() => expect(finish).toBeDefined())
    await f.recorder.manage(f.tab, 'start')
    finish({ selector: 'p', tag: 'p', observedMatch: true } as never)
    await rejected
    expect((await f.recorder.manage(f.tab, 'get')).steps.every(step => step.kind !== 'expect')).toBe(true)
  })
})

describe('Repro checkpoint page error boundary', () => {
  it.each([
    ['excluded-target', 'form values'],
    ['ambiguous-target', 'exactly one'],
    ['invalid-selector', 'valid CSS'],
    ['unsupported-target', 'represented safely'],
    ['private page-authored error', 'represented safely']
  ])('maps %s to a fixed main-process error without adding a step', async (error, message) => {
    const f = fixture()
    const before = await f.recorder.manage(f.tab, 'start')
    f.executeJavaScript.mockResolvedValue({ error } as never)
    await expect(f.recorder.manage(f.tab, 'checkpoint', { context: before.checkpointContext, selector: 'p', condition: 'visible', reviewed: true })).rejects.toThrow(message)
    expect((await f.recorder.manage(f.tab, 'get')).steps).toEqual(before.steps)
  })
})

describe('Repro checkpoint stalled page reads', () => {
  it.each(['stop', 'retry'] as const)('rejects a stalled read, permits %s, and ignores its late result', async action => {
    vi.useFakeTimers()
    const f = fixture()
    const report = await f.recorder.manage(f.tab, 'start')
    const request = { context: report.checkpointContext, selector: 'p', condition: 'visible', reviewed: true }
    let finish!: (value: never) => void
    f.executeJavaScript.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    let outcome: string | undefined
    const pending = f.recorder.manage(f.tab, 'checkpoint', request).then(() => { outcome = 'accepted' }, error => { outcome = String(error) })
    await vi.advanceTimersByTimeAsync(0)
    let stopped: Awaited<ReturnType<typeof f.recorder.manage>> | undefined
    const stop = action === 'stop' ? f.recorder.manage(f.tab, 'stop').then(value => { stopped = value }) : Promise.resolve()
    try {
      await vi.advanceTimersByTimeAsync(5001)
      expect(outcome).toContain('Checkpoint page read timed out')
      if (action === 'stop') expect(stopped).toMatchObject({ active: false, stepCount: 1 })
      else {
        f.executeJavaScript.mockResolvedValueOnce({ selector: 'p', tag: 'p', observedMatch: true } as never)
        const retried = await f.recorder.manage(f.tab, 'checkpoint', request)
        expect(retried.steps.filter(step => step.kind === 'expect')).toHaveLength(1)
      }
      const beforeLateResult = await f.recorder.manage(f.tab, 'get')
      finish({ selector: 'p', tag: 'p', observedMatch: true } as never)
      await pending
      await stop
      expect(await f.recorder.manage(f.tab, 'get')).toEqual(beforeLateResult)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      finish?.({ selector: 'p', tag: 'p', observedMatch: true } as never)
      await pending
      await stop
      f.recorder.clearReproRecording(f.tab)
    }
  })
})

it('times out a stalled start without accepting its late result or blocking a retry', async () => {
  vi.useFakeTimers()
  const f = fixture()
  let release!: (value: { x: number; y: number }) => void
  f.executeJavaScript.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  let outcome = 'pending'
  const pending = f.recorder.manage(f.tab, 'start').then(
    () => { outcome = 'accepted' },
    error => { outcome = String(error) }
  )
  try {
    await vi.advanceTimersByTimeAsync(5000)
    expect(outcome).toContain('Reproduction start timed out')
    expect((await f.recorder.manage(f.tab, 'get')).active).toBe(false)
    const restarted = await f.recorder.manage(f.tab, 'start')
    expect(restarted).toMatchObject({ active: true, stepCount: 1 })
    release({ x: 0, y: 999 })
    await pending
    expect(await f.recorder.manage(f.tab, 'get')).toEqual(restarted)
    expect(f.tab.reproRecording!.scrollPosition).toEqual({ x: 0, y: 0 })
  } finally {
    release({ x: 0, y: 999 })
    await pending
    f.recorder.clearReproRecording(f.tab)
  }
})

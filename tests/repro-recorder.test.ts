import type { Input, WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserReproRecorder, type BrowserReproRecordingInternal } from '../src/main/browser/repro-recorder.js'
import { reproScrollScript } from '../src/main/browser/page-scripts.js'

const enterKey: Input = {
  type: 'keyDown', key: 'Enter', code: 'Enter', isAutoRepeat: false,
  isComposing: false, shift: false, control: false, alt: false, meta: false,
  location: 0, modifiers: []
}

function fixture() {
  const executeJavaScript = vi.fn(async (script: string) => script === reproScrollScript()
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

afterEach(() => vi.restoreAllMocks())

describe('reproduction recorder data contracts', () => {
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

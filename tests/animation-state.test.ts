import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { ANIMATION_STATE_CAVEATS } from '../src/shared/animation-state.js'
import {
  animationState,
  animationStateScript,
  animationStateSettlementScript,
  normalizeAnimationState
} from '../src/main/browser/animation-state/animation-state.js'

interface Timing {
  delay: number; endDelay: number; duration: number; iterations: number; iterationStart: number; direction: string; fill: string
  progress: number | null; currentIteration: number | null; activeDuration: number; endTime: number; localTime: number | null
}

const timing = (overrides: Partial<Timing> = {}): Timing => ({
  delay: 0, endDelay: 0, duration: 1000, iterations: 1, iterationStart: 0, direction: 'normal', fill: 'none',
  progress: 0.25, currentIteration: 0, activeDuration: 1000, endTime: 1000, localTime: 250, ...overrides
})

/** A page with the native shapes the script reads: accessors on prototypes, as Chromium defines them. */
function page(selectorMatches: number, animations: (realm: ReturnType<typeof realmClasses>, element: object) => object[]) {
  const realm = realmClasses()
  const element = new realm.Element()
  const list = animations(realm, element)
  realm.Element.prototype.getAnimations = function () { return list }
  realm.setMatches(Array.from({ length: selectorMatches }, () => element))
  const observers: Array<{ notify: (records: object[]) => void; pending: object[] }> = []
  const context = {
    ...realm,
    globalThis: undefined as unknown,
    document: new realm.Document(),
    MutationObserver: class {
      readonly pending: object[] = []
      constructor(callback: (records: object[]) => void) { observers.push({ notify: records => callback(records), pending: this.pending }) }
      observe() {}
      disconnect() {}
      takeRecords() { return this.pending.splice(0) }
    },
    setTimeout: () => 1,
    clearTimeout: () => undefined
  }
  context.globalThis = context
  realm.setDocument(context.document)
  const run = (code: string) => runInNewContext(code, context) as unknown
  return { run, element, realm, observers, context }
}

function realmClasses() {
  const timeline = {}
  const state = { document: undefined as unknown, matches: [] as unknown[] }
  /** Animations whose effect, and effects whose timing, the script read. */
  const reads = { effect: [] as object[], timing: [] as object[] }
  class Node {
    connected = true
    readonly children: Node[] = []
    get isConnected() { return this.connected }
    getRootNode() { return state.document }
    contains(other: unknown): boolean { return other === this || this.children.some(child => child.contains(other)) }
  }
  class Element extends Node {
    getAnimations(): object[] { return [] }
  }
  class Document extends Node {
    get timeline() { return timeline }
    querySelectorAll(selector: string) {
      if (selector === '!!') throw new SyntaxError('bad')
      return state.matches
    }
  }
  class MutationRecord {
    constructor(private readonly removed: object[], private readonly kind = 'childList') {}
    get type() { return this.kind }
    get removedNodes() { return this.removed }
  }
  class AnimationEffect {
    constructor(private readonly computed: Timing) {}
    getComputedTiming() { reads.timing.push(this); return this.computed }
  }
  class KeyframeEffect extends AnimationEffect {
    constructor(computed: Timing, private readonly targetElement: object, private readonly pseudo: string | null = null) { super(computed) }
    get target() { return this.targetElement }
    get pseudoElement() { return this.pseudo }
  }
  class Animation {
    constructor(private readonly options: { effect: object; timeline?: object | null; playState?: string; pending?: boolean; playbackRate?: number; currentTime?: number | null; startTime?: number | null }) {}
    get timeline() { return this.options.timeline === undefined ? timeline : this.options.timeline }
    get effect() { reads.effect.push(this); return this.options.effect }
    get playState() { return this.options.playState ?? 'running' }
    get pending() { return this.options.pending ?? false }
    get playbackRate() { return this.options.playbackRate ?? 1 }
    get currentTime() { return this.options.currentTime === undefined ? 250 : this.options.currentTime }
    get startTime() { return this.options.startTime === undefined ? 10 : this.options.startTime }
  }
  class CSSAnimation extends Animation {}
  class CSSTransition extends Animation {}
  return {
    Node, Element, Document, MutationRecord, AnimationEffect, KeyframeEffect, Animation, CSSAnimation, CSSTransition, timeline, reads,
    setDocument: (document: unknown) => { state.document = document },
    setMatches: (matches: unknown[]) => { state.matches = matches }
  }
}

function read(selectorMatches: number, animations: Parameters<typeof page>[1], selector = '#target') {
  const fixture = page(selectorMatches, animations)
  return { ...fixture, result: fixture.run(animationStateScript(selector, 'token-1')) as Record<string, unknown> }
}

it('reads kind, state, timing and phase from native accessors, and normalizes the report', () => {
  const { result } = read(1, ({ Animation, CSSAnimation, CSSTransition, KeyframeEffect }, element) => [
    new CSSAnimation({ effect: new KeyframeEffect(timing({ iterations: Infinity, activeDuration: Infinity, endTime: Infinity }), element) }),
    new CSSTransition({ effect: new KeyframeEffect(timing({ delay: 500, localTime: 100, progress: null, currentIteration: null, endTime: 1500, activeDuration: 1000 }), element) }),
    new Animation({ effect: new KeyframeEffect(timing({ localTime: 1000, progress: 1, fill: 'forwards' }), element), playState: 'finished', currentTime: 1000 }),
    new Animation({ effect: new KeyframeEffect(timing({ localTime: null, progress: null, currentIteration: null }), element), playState: 'idle', currentTime: null, startTime: null }),
    new Animation({ effect: new KeyframeEffect(timing(), element), playState: 'paused', startTime: null, playbackRate: -0.5 }),
    // On a boundary, the playback direction settles the phase.
    new Animation({ effect: new KeyframeEffect(timing({ localTime: 1000, progress: 1 }), element), playbackRate: -1 }),
    new Animation({ effect: new KeyframeEffect(timing({ localTime: 0, progress: null, currentIteration: null }), element), playbackRate: -1 }),
    // A stopped animation on its end boundary is after it; a negative delay starts it part-way through.
    new Animation({ effect: new KeyframeEffect(timing({ localTime: 1000, progress: 1 }), element), playbackRate: 0 }),
    new Animation({ effect: new KeyframeEffect(timing({ delay: -500, localTime: 0, endTime: 500 }), element) }),
    // An infinite duration is valid, and a huge rate is reported as it is.
    new Animation({ effect: new KeyframeEffect(timing({ duration: Infinity, activeDuration: Infinity, endTime: Infinity, progress: 0 }), element), playbackRate: 1e306 })
  ])
  const report = normalizeAnimationState(result, 'tab-1')
  expect(report).toMatchObject({ tabId: 'tab-1', count: 10, omitted: { unsupportedTimeline: 0, unsupportedEffect: 0, beyondLimit: 0, notExamined: 0 }, caveats: ANIMATION_STATE_CAVEATS })
  expect(report.animations.map(({ index, kind, playState, phase }) => [index, kind, playState, phase])).toEqual([
    [1, 'css-animation', 'running', 'active'],
    [2, 'css-transition', 'running', 'before'],
    [3, 'web-animation', 'finished', 'after'],
    [4, 'web-animation', 'idle', 'idle'],
    [5, 'web-animation', 'paused', 'active'],
    [6, 'web-animation', 'running', 'active'],
    [7, 'web-animation', 'running', 'before'],
    [8, 'web-animation', 'running', 'after'],
    [9, 'web-animation', 'running', 'active'],
    [10, 'web-animation', 'running', 'active']
  ])
  expect(report.animations[9]).toMatchObject({ durationMs: 'infinite', activeDurationMs: 'infinite', endTimeMs: 'infinite', playbackRate: 1e306 })
  expect(report.animations[0]).toMatchObject({ iterations: 'infinite', activeDurationMs: 'infinite', endTimeMs: 'infinite', currentTimeMs: 250, startTimeMs: 10, progress: 0.25 })
  expect(report.animations[1]).toMatchObject({ delayMs: 500, progress: null, currentIteration: null })
  expect(report.animations[3]).toMatchObject({ currentTimeMs: null, startTimeMs: null, localTimeMs: null })
  expect(report.animations[4]).toMatchObject({ playbackRate: -0.5, startTimeMs: null })
})

it('omits other timelines and effects before reading their fields, and bounds what it examines and returns', () => {
  const unsupported: object[] = []
  const { result, realm } = read(1, ({ Animation, KeyframeEffect, AnimationEffect }, element) => {
    const scroll = new Animation({ effect: new KeyframeEffect(timing(), element), timeline: {} })
    const detached = new Animation({ effect: new KeyframeEffect(timing(), element), timeline: null })
    const effects = [new KeyframeEffect(timing(), element, '::before'), new KeyframeEffect(timing(), {}), new AnimationEffect(timing())]
    unsupported.push(scroll, detached, ...effects)
    return [
      scroll,
      detached,
      ...effects.map(effect => new Animation({ effect })),
      ...Array.from({ length: 300 }, () => new Animation({ effect: new KeyframeEffect(timing(), element) }))
    ]
  })
  const report = normalizeAnimationState(result, 'tab-1')
  expect(report.count).toBe(305)
  expect(report.animations).toHaveLength(20)
  expect(report.animations.at(-1)!.index).toBe(20)
  expect(report.omitted).toEqual({ unsupportedTimeline: 2, unsupportedEffect: 3, beyondLimit: 175, notExamined: 105 })
  // Another timeline's effect is never read, and another effect's timing is never read.
  expect(realm.reads.effect).not.toContain(unsupported[0])
  expect(realm.reads.effect).not.toContain(unsupported[1])
  for (const effect of unsupported.slice(2)) expect(realm.reads.timing).not.toContain(effect)
  // Timings are read for the 20 reported animations only.
  expect(realm.reads.timing).toHaveLength(20)
})

it('reads the element and document through native accessors, so named elements cannot shadow them', () => {
  const clobbered = page(1, () => [])
  const poison = () => { throw new Error('page value') }
  Object.defineProperty(clobbered.context.document, 'querySelectorAll', { get: poison })
  Object.defineProperty(clobbered.element, 'isConnected', { get: poison })
  Object.defineProperty(clobbered.element, 'getRootNode', { get: poison })
  Object.defineProperty(clobbered.context, '__hronautAnimationState', { get: poison })
  expect(clobbered.run(animationStateScript('#target', 'token-1'))).toMatchObject({ count: 0 })
  expect(clobbered.run(animationStateSettlementScript('token-1'))).toBe(true)
})

it('reports a missing, ambiguous or invalid target and a value the browser should never produce as distinct failures', () => {
  const none = read(0, () => [])
  expect(() => normalizeAnimationState(none.result, 'tab-1')).toThrow('exactly one element')
  const two = read(2, () => [])
  expect(() => normalizeAnimationState(two.result, 'tab-1')).toThrow('exactly one element')
  const invalid = read(1, () => [], '!!')
  expect(() => normalizeAnimationState(invalid.result, 'tab-1')).toThrow('valid CSS selector')
  const nan = read(1, ({ Animation, KeyframeEffect }, element) => [new Animation({ effect: new KeyframeEffect(timing({ delay: Number.NaN }), element) })])
  expect(() => normalizeAnimationState(nan.result, 'tab-1')).toThrow('did not report')
  const state = read(1, ({ Animation, KeyframeEffect }, element) => [new Animation({ effect: new KeyframeEffect(timing(), element), playState: 'private-state' })])
  expect(() => normalizeAnimationState(state.result, 'tab-1')).toThrow('did not report')
})

it('settles while the same element is the unique match, in place and unchanged, ignoring unrelated changes, and limits waiting readings', () => {
  const fixture = read(1, () => [])
  expect(fixture.run(animationStateSettlementScript('token-1'))).toBe(true)
  expect(fixture.run(animationStateSettlementScript('token-1'))).toBe(false)

  // A ticking counter elsewhere in the page does not fail publication.
  const unrelated = read(1, () => [])
  unrelated.observers[0]!.notify([new unrelated.realm.MutationRecord([new unrelated.realm.Element()])])
  expect(unrelated.run(animationStateSettlementScript('token-1'))).toBe(true)

  // Removing an ancestor of the target does, whether delivered or still pending.
  for (const delivered of [true, false]) {
    const moved = read(1, () => [])
    const ancestor = new moved.realm.Element()
    ancestor.children.push(moved.element as InstanceType<typeof moved.realm.Element>)
    const record = new moved.realm.MutationRecord([ancestor])
    if (delivered) moved.observers[0]!.notify([record])
    else moved.observers[0]!.pending.push(record)
    expect(moved.run(animationStateSettlementScript('token-1'))).toBe(false)
  }

  // So does a change to the target's own attributes, which can restart its CSS animations.
  const restyled = read(1, () => [])
  restyled.observers[0]!.notify([new restyled.realm.MutationRecord([], 'attributes')])
  expect(restyled.run(animationStateSettlementScript('token-1'))).toBe(false)

  const replaced = read(1, () => [])
  replaced.realm.setMatches([new replaced.realm.Element()])
  expect(replaced.run(animationStateSettlementScript('token-1'))).toBe(false)
  const disconnected = read(1, () => [])
  ;(disconnected.element as InstanceType<typeof disconnected.realm.Element>).connected = false
  expect(disconnected.run(animationStateSettlementScript('token-1'))).toBe(false)

  const busy = page(1, () => [])
  for (let index = 0; index < 8; index++) busy.run(animationStateScript('#target', `token-${index}`))
  expect(busy.run(animationStateScript('#target', 'token-9'))).toEqual({ failure: 'busy' })
  busy.run(animationStateSettlementScript('token-0', true))
  expect(busy.run(animationStateScript('#target', 'token-9'))).toHaveProperty('count', 0)
})

it('refuses reports that do not match the contract', () => {
  const valid = { observedAt: 1, count: 0, animations: [], omitted: { unsupportedTimeline: 0, unsupportedEffect: 0, beyondLimit: 0, notExamined: 0 } }
  expect(normalizeAnimationState(valid, 'tab-1')).toMatchObject({ count: 0, animations: [] })
  for (const raw of [
    null,
    { ...valid, extra: true },
    { ...valid, count: 1 },
    { ...valid, omitted: { ...valid.omitted, notExamined: -1 } },
    { ...valid, animations: [{ index: 1 }], count: 1 },
    { failure: 'page-message: private' }
  ]) {
    expect(() => normalizeAnimationState(raw, 'tab-1')).toThrow('invalid report')
  }
})

it('embeds the selector as data and rejects snapshot refs', async () => {
  expect(animationStateScript('a"); alert(1); ("', 'token')).toContain(JSON.stringify('a"); alert(1); ("'))
  // Markup and line separators are escaped, so the embedded literal cannot end a script or a line.
  const script = animationStateScript('[title="</script>\u2028\u2029"]', 'token')
  expect(script).not.toMatch(/<\/script>|[\u2028\u2029]/)
  expect(script).toContain('"[title=\\"\\u003c/script\\u003e\\u2028\\u2029\\"]"')
  expect(animationStateSettlementScript('</script>\u2028')).not.toMatch(/<\/script>|\u2028/)
  const access = { getTab: vi.fn() }
  await expect(animationState(access as never, { selector: '#a', ref: 'e1' } as never)).rejects.toThrow('snapshot refs')
  await expect(animationState(access as never, { selector: ' ' })).rejects.toThrow('nonempty selector')
  expect(access.getTab).not.toHaveBeenCalled()
})

it('defers publication to a settlement that rechecks the target, and cancels an unpublished reading', async () => {
  const report = { observedAt: 1, count: 0, animations: [], omitted: { unsupportedTimeline: 0, unsupportedEffect: 0, beyondLimit: 0, notExamined: 0 } }
  const scripts: string[] = []
  let settles = true
  const webContents = {
    isDestroyed: () => false,
    executeJavaScriptInIsolatedWorld: vi.fn(async (_world: number, sources: Array<{ code: string }>) => {
      const code = sources[0]!.code
      scripts.push(code)
      return code.includes('handle.settle()') ? settles : code.includes('handle?.cleanup()') ? false : report
    })
  } as unknown as WebContents
  const tab = { id: 'tab-1', url: 'https://app.test/', title: 'App', webContents, sleeping: false, pageLifecycleState: 'active', emulation: {} }
  const access = {
    getTab: () => tab,
    findTab: () => tab,
    findWorkspace: () => undefined,
    inspectionPermission: () => 0,
    snapshotDeltaContext: () => ({ tabId: 'tab-1', workspaceId: null, navigationGeneration: 1, observationGeneration: 0, humanInteractionGeneration: 0, snapshotFormatVersion: 1 })
  }
  let pending: { finish(): Promise<void>; discard(): void } | undefined
  const result = await animationState(access as never, { selector: '#a' }, undefined, inspection => { pending = inspection })
  expect(result).toMatchObject({ tabId: 'tab-1', count: 0 })
  await pending!.finish()
  settles = false
  await animationState(access as never, { selector: '#a' }, undefined, inspection => { pending = inspection })
  await expect(pending!.finish()).rejects.toThrow('changed before publication')
  scripts.length = 0
  await animationState(access as never, { selector: '#a' }, undefined, inspection => { pending = inspection })
  pending!.discard()
  expect(scripts.at(-1)).toContain('handle?.cleanup()')
})

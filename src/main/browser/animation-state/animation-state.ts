import { randomUUID } from 'node:crypto'
import {
  ANIMATION_STATE_CAVEATS,
  ANIMATION_STATE_LIMITS,
  type BrowserAnimationRecord,
  type BrowserAnimationState
} from '../../../shared/animation-state.js'
import { javascriptLiteral } from '../../../shared/javascript-literal.js'
import { snapshotDeltaInvalidationReason } from '../../../shared/snapshot-delta.js'
import type { PendingElementInspection } from '../element-inspection-publication.js'
import type { ElementInspectionAccess, ElementInspectionTab } from '../element-inspection/element-inspection-access.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { isHronautHomeUrl } from '../url.js'

export const ANIMATION_STATE_WORLD_ID = ISOLATED_WORLDS.animationState

const PLAY_STATES = ['idle', 'running', 'paused', 'finished'] as const
const PHASES = ['before', 'active', 'after', 'idle'] as const
const KINDS = ['css-animation', 'css-transition', 'web-animation'] as const
const DIRECTIONS = ['normal', 'reverse', 'alternate', 'alternate-reverse'] as const
const FILLS = ['none', 'forwards', 'backwards', 'both'] as const
const RECORD_KEYS = [
  'index', 'kind', 'playState', 'pending', 'playbackRate', 'phase', 'currentTimeMs', 'startTimeMs', 'delayMs', 'endDelayMs', 'durationMs',
  'iterations', 'iterationStart', 'direction', 'fill', 'progress', 'currentIteration', 'activeDurationMs', 'endTimeMs', 'localTimeMs'
] as const
const OMITTED_KEYS = ['unsupportedTimeline', 'unsupportedEffect', 'beyondLimit', 'notExamined'] as const

/**
 * Reads the animations on one element in an isolated world, where the page's own prototypes, getters and
 * overrides do not exist: every value comes from the browser's native accessors, including the element's
 * and document's, which named elements could otherwise shadow. One getAnimations() call lists the
 * element's own animations; at most 200 are checked for kind, timeline and effect before any field is
 * read, and at most 20 timings are read. Names, IDs, keyframes, easing and CSS values are never returned.
 */
export function animationStateScript(selector: string, token: string): string {
  const limits = {
    maxRecords: ANIMATION_STATE_LIMITS.maxRecords,
    maxExamined: ANIMATION_STATE_LIMITS.maxExamined,
    maxReportChars: ANIMATION_STATE_LIMITS.maxReportChars,
    maxUnsettled: ANIMATION_STATE_LIMITS.maxUnsettled,
    deadlineMs: ANIMATION_STATE_LIMITS.deadlineMs
  }
  return `(() => {
    const selector = ${javascriptLiteral(selector)}, token = ${javascriptLiteral(token)}, limits = ${javascriptLiteral(limits)};
    // A symbol key and an own property: an element with a matching id cannot stand in for the registry.
    const key = Symbol.for('hronaut.animationState');
    if (!Object.getOwnPropertyDescriptor(globalThis, key)) Object.defineProperty(globalThis, key, { value: new Map() });
    const handles = Object.getOwnPropertyDescriptor(globalThis, key).value;
    if (handles.size >= limits.maxUnsettled) return { failure: 'busy' };
    const native = (proto, name) => {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      const fn = descriptor && (descriptor.get || descriptor.value);
      if (typeof fn !== 'function') throw Error('native accessor');
      return fn;
    };
    const read = (proto, name, target, ...args) => Reflect.apply(native(proto, name), target, args);
    const resolve = () => read(Document.prototype, 'querySelectorAll', document, selector);
    const inDocument = node => read(Node.prototype, 'isConnected', node) && read(Node.prototype, 'getRootNode', node) === document;
    let matches, element;
    try {
      try { matches = resolve() } catch { return { failure: 'invalid-selector' } }
      if (matches.length !== 1) return { failure: 'non-unique-target' };
      element = matches[0];
      if (!inDocument(element)) return { failure: 'unsupported-target' };
    } catch { return { failure: 'native-unavailable' } }
    const finite = value => {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('scalar');
      return value;
    };
    // Times are rounded to microseconds where that cannot overflow; larger values are already coarser than that.
    // Unitless values (rates, progress, iteration counts) are reported as the browser gives them.
    const ms = value => { finite(value); return Math.abs(value) < 1e12 ? Math.round(value * 1000) / 1000 : value };
    const unbounded = (value, convert = finite) => value === Infinity ? 'infinite' : convert(value);
    const unboundedMs = value => unbounded(value, ms);
    const nullable = (value, convert) => value === null ? null : convert(value);
    const oneOf = (value, allowed) => { if (!allowed.includes(value)) throw Error('scalar'); return value };
    const boolean = value => { if (typeof value !== 'boolean') throw Error('scalar'); return value };
    // The Web Animations phase rules: boundaries clamp to the end time, and the playback direction settles a tie.
    const phaseOf = (local, delay, activeDuration, endTime, rate) => {
      if (local === null) return 'idle';
      const beforeActive = Math.max(Math.min(delay, endTime), 0);
      const activeAfter = Math.max(Math.min(delay + activeDuration, endTime), 0);
      if (local < beforeActive || (rate < 0 && local === beforeActive)) return 'before';
      if (local > activeAfter || (rate >= 0 && local === activeAfter)) return 'after';
      return 'active';
    };
    let dirty = false;
    // Publication only checks that the reading still describes the same element: removing or moving the target or
    // an ancestor fails it, and a replacement is caught when the selector is resolved again. Other changes, such as
    // a progress bar updating its own attributes or a counter ticking beside a spinner, do not; the reading is a
    // sample taken at observedAt, not a promise that the animations are unchanged since.
    const removesTarget = records => {
      for (const record of records) {
        for (const node of read(MutationRecord.prototype, 'removedNodes', record)) {
          if (read(Node.prototype, 'contains', node, element)) return true;
        }
      }
      return false;
    };
    const observer = new MutationObserver(records => { if (removesTarget(records)) { dirty = true; observer.disconnect() } });
    observer.observe(document, { subtree: true, childList: true });
    let timer;
    const cleanup = () => { observer.disconnect(); clearTimeout(timer); handles.delete(token) };
    try {
      const animations = Reflect.apply(native(Element.prototype, 'getAnimations'), element, []);
      const documentTimeline = read(Document.prototype, 'timeline', document);
      const count = animations.length;
      const omitted = { unsupportedTimeline: 0, unsupportedEffect: 0, beyondLimit: 0, notExamined: Math.max(0, count - limits.maxExamined) };
      const records = [];
      for (let position = 0; position < count && position < limits.maxExamined; position++) {
        const animation = animations[position];
        if (!(animation instanceof Animation) || read(Animation.prototype, 'timeline', animation) !== documentTimeline) { omitted.unsupportedTimeline++; continue }
        const effect = read(Animation.prototype, 'effect', animation);
        if (!(effect instanceof KeyframeEffect) || read(KeyframeEffect.prototype, 'target', effect) !== element
          || read(KeyframeEffect.prototype, 'pseudoElement', effect) !== null) { omitted.unsupportedEffect++; continue }
        if (records.length >= limits.maxRecords) { omitted.beyondLimit++; continue }
        const timing = Reflect.apply(native(AnimationEffect.prototype, 'getComputedTiming'), effect, []);
        const rate = read(Animation.prototype, 'playbackRate', animation);
        const local = timing.localTime, delay = timing.delay, activeDuration = timing.activeDuration, endTime = timing.endTime;
        const record = {
          index: records.length + 1,
          kind: animation instanceof CSSTransition ? 'css-transition' : animation instanceof CSSAnimation ? 'css-animation' : 'web-animation',
          playState: oneOf(read(Animation.prototype, 'playState', animation), ${javascriptLiteral(PLAY_STATES)}),
          pending: boolean(read(Animation.prototype, 'pending', animation)),
          playbackRate: finite(rate),
          phase: 'idle',
          currentTimeMs: nullable(read(Animation.prototype, 'currentTime', animation), ms),
          startTimeMs: nullable(read(Animation.prototype, 'startTime', animation), ms),
          delayMs: ms(delay),
          endDelayMs: ms(timing.endDelay),
          durationMs: unboundedMs(timing.duration),
          iterations: unbounded(timing.iterations),
          iterationStart: finite(timing.iterationStart),
          direction: oneOf(timing.direction, ${javascriptLiteral(DIRECTIONS)}),
          fill: oneOf(timing.fill, ${javascriptLiteral(FILLS)}),
          progress: nullable(timing.progress, finite),
          currentIteration: nullable(timing.currentIteration, unbounded),
          activeDurationMs: unboundedMs(activeDuration),
          endTimeMs: unboundedMs(endTime),
          localTimeMs: nullable(local, ms)
        };
        record.phase = phaseOf(local, delay, activeDuration, endTime, rate);
        records.push(record);
      }
      const result = { observedAt: Date.now(), count, animations: records, omitted };
      if (JSON.stringify(result).length > limits.maxReportChars) throw Error('output limit');
      const settle = () => {
        try {
          if (dirty || removesTarget(observer.takeRecords()) || !inDocument(element)) return false;
          const current = resolve();
          return current.length === 1 && current[0] === element;
        } catch { return false } finally { cleanup() }
      };
      timer = setTimeout(cleanup, limits.deadlineMs);
      handles.set(token, { settle, cleanup });
      return result;
    } catch { cleanup(); return { failure: 'native-unavailable' } }
  })()`
}

export function animationStateSettlementScript(token: string, cancel = false): string {
  return `(() => {const handle=Object.getOwnPropertyDescriptor(globalThis,Symbol.for('hronaut.animationState'))?.value?.get(${javascriptLiteral(token)});${cancel ? 'handle?.cleanup();return false' : 'return handle?handle.settle():false'}})()`
}

const FAILURES: Record<string, string> = {
  busy: 'Animation state unavailable: too many readings of this tab are waiting to be published',
  'invalid-selector': 'Animation state requires a valid CSS selector',
  'non-unique-target': 'Animation state requires a selector that matches exactly one element in the top-level document',
  'unsupported-target': 'Animation state unsupported: select a connected element in the top-level document',
  'native-unavailable': 'Animation state unavailable: the browser did not report the animation state'
}

function isRecordOf(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const own = Object.keys(value)
  return own.length === keys.length && own.every(key => keys.includes(key))
}

const finite = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value)
const unbounded = (value: unknown): boolean => value === 'infinite' || finite(value)
const count = (value: unknown): boolean => typeof value === 'number' && Number.isInteger(value) && value >= 0

function validRecord(value: unknown, index: number): value is BrowserAnimationRecord {
  if (!isRecordOf(value, RECORD_KEYS)) return false
  return value.index === index
    && (KINDS as readonly unknown[]).includes(value.kind)
    && (PLAY_STATES as readonly unknown[]).includes(value.playState)
    && typeof value.pending === 'boolean'
    && finite(value.playbackRate)
    && (PHASES as readonly unknown[]).includes(value.phase)
    && (value.currentTimeMs === null || finite(value.currentTimeMs))
    && (value.startTimeMs === null || finite(value.startTimeMs))
    && finite(value.delayMs) && finite(value.endDelayMs) && (value.durationMs === 'infinite' || (finite(value.durationMs) && (value.durationMs as number) >= 0))
    && unbounded(value.iterations) && finite(value.iterationStart)
    && (DIRECTIONS as readonly unknown[]).includes(value.direction)
    && (FILLS as readonly unknown[]).includes(value.fill)
    && (value.progress === null || (finite(value.progress) && (value.progress as number) >= 0 && (value.progress as number) <= 1))
    && (value.currentIteration === null || unbounded(value.currentIteration))
    && unbounded(value.activeDurationMs) && unbounded(value.endTimeMs)
    && (value.localTimeMs === null || finite(value.localTimeMs))
}

/** Checks the page's reply field by field and adds the tab and caveats; anything unexpected is refused, not passed on. */
export function normalizeAnimationState(raw: unknown, tabId: string): BrowserAnimationState {
  const invalid = (): never => { throw new Error('Animation state unavailable: invalid report from the page') }
  if (isRecordOf(raw, ['failure']) && typeof raw.failure === 'string' && Object.hasOwn(FAILURES, raw.failure)) throw new Error(FAILURES[raw.failure])
  if (!isRecordOf(raw, ['observedAt', 'count', 'animations', 'omitted'])) return invalid()
  if (!count(raw.observedAt) || !count(raw.count) || !Array.isArray(raw.animations) || raw.animations.length > ANIMATION_STATE_LIMITS.maxRecords) return invalid()
  if (!raw.animations.every((record, position) => validRecord(record, position + 1))) return invalid()
  if (!isRecordOf(raw.omitted, OMITTED_KEYS) || !OMITTED_KEYS.every(key => count((raw.omitted as Record<string, unknown>)[key]))) return invalid()
  const omitted = raw.omitted as BrowserAnimationState['omitted']
  const accounted = raw.animations.length + omitted.unsupportedTimeline + omitted.unsupportedEffect + omitted.beyondLimit + omitted.notExamined
  if (accounted !== raw.count) return invalid()
  if (JSON.stringify(raw).length > ANIMATION_STATE_LIMITS.maxReportChars) return invalid()
  return {
    tabId,
    observedAt: raw.observedAt as number,
    count: raw.count as number,
    animations: raw.animations as BrowserAnimationRecord[],
    omitted,
    caveats: [...ANIMATION_STATE_CAVEATS]
  }
}

/** Reads the animations on one element, guarded against observation changes until publication. */
export async function animationState<Tab extends ElementInspectionTab>(
  access: ElementInspectionAccess<Tab>,
  options: { tabId?: string; ref?: never; selector: string },
  validateInspection?: () => void,
  deferInspection?: (pending: PendingElementInspection) => void
): Promise<BrowserAnimationState> {
  if (Object.hasOwn(options, 'ref')) throw new TypeError('Animation state does not support snapshot refs; provide a unique selector')
  if (typeof options.selector !== 'string' || !options.selector.trim() || options.selector.length > ANIMATION_STATE_LIMITS.maxSelectorChars) {
    throw new TypeError(`Animation state requires a nonempty selector of at most ${ANIMATION_STATE_LIMITS.maxSelectorChars} characters`)
  }
  const tab = access.getTab(options.tabId)
  const context = access.snapshotDeltaContext(tab)
  const workspace = tab.mcpGroupId ? access.findWorkspace(tab.mcpGroupId) : undefined
  const permissionGeneration = workspace ? access.inspectionPermission(workspace) ?? 0 : 0
  const assertCurrent = (): void => {
    validateInspection?.()
    const currentWorkspace = tab.mcpGroupId ? access.findWorkspace(tab.mcpGroupId) : undefined
    if (access.findTab(tab.id) !== tab || tab.webContents.isDestroyed()
      || currentWorkspace !== workspace || (currentWorkspace ? access.inspectionPermission(currentWorkspace) ?? 0 : 0) !== permissionGeneration
      || snapshotDeltaInvalidationReason(context, access.snapshotDeltaContext(tab))) throw new Error('The observation context changed during animation inspection')
    if (isHronautHomeUrl(tab.url) || tab.sleeping || tab.wakePromise || tab.pageLifecycleState !== 'active') {
      throw new Error('Animation state unavailable: requires an already active website tab')
    }
  }
  assertCurrent()
  const token = randomUUID()
  const deadline = Date.now() + ANIMATION_STATE_LIMITS.deadlineMs
  const bounded = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Animation state inspection expired')), Math.max(1, deadline - Date.now()))
      })])
    } finally { if (timer) clearTimeout(timer) }
  }
  const execute = (code: string) => tab.webContents.executeJavaScriptInIsolatedWorld(ANIMATION_STATE_WORLD_ID, [{ code }], false)
  let settled = false
  let deferred = false
  const pending: PendingElementInspection = {
    assertCurrent,
    finish: async () => {
      assertCurrent()
      const valid = await bounded(execute(animationStateSettlementScript(token)))
      assertCurrent()
      if (valid !== true) throw new Error('The animation target changed before publication')
      settled = true
    },
    discard: () => { if (!settled && !tab.webContents.isDestroyed()) void execute(animationStateSettlementScript(token, true)).catch(() => undefined) }
  }
  try {
    const raw: unknown = await bounded(execute(animationStateScript(options.selector, token)))
    assertCurrent()
    const report = normalizeAnimationState(raw, tab.id)
    if (deferInspection) { deferInspection(pending); deferred = true } else await pending.finish()
    return report
  } finally { if (!deferred) pending.discard() }
}

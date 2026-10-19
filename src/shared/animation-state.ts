export const ANIMATION_STATE_LIMITS = {
  maxSelectorChars: 1_000,
  /** Animations returned, in the browser's order. */
  maxRecords: 20,
  /** Animations whose kind, timeline and effect are checked; later ones are counted, never read. */
  maxExamined: 200,
  maxReportChars: 16_384,
  /** Readings per tab still waiting for publication. */
  maxUnsettled: 8,
  deadlineMs: 5_000
} as const

export type AnimationStateKind = 'css-animation' | 'css-transition' | 'web-animation'
export type AnimationPlayState = 'idle' | 'running' | 'paused' | 'finished'
/** Where the local time sits against the delay and active duration, as the Web Animations model defines it; idle without a local time. */
export type AnimationPhase = 'before' | 'active' | 'after' | 'idle'
export type AnimationDirection = 'normal' | 'reverse' | 'alternate' | 'alternate-reverse'
/** The computed fill: the browser resolves a Web Animation's `auto` before it is read. */
export type AnimationFill = 'none' | 'forwards' | 'backwards' | 'both'
/** A time or count that can be infinite, which JSON cannot carry as a number. */
export type AnimationUnbounded = number | 'infinite'

export interface BrowserAnimationRecord {
  /** 1-based position in this report only: not a handle, and not stable across readings. */
  index: number
  kind: AnimationStateKind
  playState: AnimationPlayState
  pending: boolean
  playbackRate: number
  phase: AnimationPhase
  /** null when unresolved. */
  currentTimeMs: number | null
  startTimeMs: number | null
  delayMs: number
  endDelayMs: number
  durationMs: AnimationUnbounded
  iterations: AnimationUnbounded
  iterationStart: number
  direction: AnimationDirection
  fill: AnimationFill
  /** Progress within the current iteration from 0 to 1, or null outside the effect's active interval and fill. */
  progress: number | null
  currentIteration: AnimationUnbounded | null
  activeDurationMs: AnimationUnbounded
  endTimeMs: AnimationUnbounded
  localTimeMs: number | null
}

export interface BrowserAnimationState {
  tabId: string
  /** Unix milliseconds when the page read the animations. */
  observedAt: number
  /** Animations the browser reports directly on the element, read or not. */
  count: number
  animations: BrowserAnimationRecord[]
  omitted: {
    /** Animations not on the document's default timeline (scroll- or view-driven, another document timeline, or none): their fields are never read. */
    unsupportedTimeline: number
    /** Animations whose effect is not a keyframe effect on the element itself. */
    unsupportedEffect: number
    /** Supported animations past the record limit. */
    beyondLimit: number
    /** Animations past the examination limit, counted but never checked. */
    notExamined: number
  }
  caveats: string[]
}

export const ANIMATION_STATE_CAVEATS = [
  'Only CSS animations, CSS transitions and Web Animations running directly on this element on the document timeline are read. An empty list does not mean the page is still: requestAnimationFrame loops, canvas, video, scroll-driven animations, descendants and pseudo-elements are not included.',
  'This is one sampled reading. Times are in milliseconds on the document timeline; repeat the reading to see progress. The browser lists only animations that are running, pending, paused before their end or filling, so a finished animation without a forwards fill, or a cancelled one, is neither listed nor counted.',
  'Timing state does not prove that the motion is visible, smooth or composited, or that reduced-motion preferences are honored.',
  'Animation names, IDs, keyframes, easing and CSS values are never returned.'
]

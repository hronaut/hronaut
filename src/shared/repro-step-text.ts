import type { BrowserReproTarget } from './types.js'

// The English sentences the repro recorder writes for each step. Main writes them into MCP results and copied
// timelines; the renderer recognizes them to show the step in the interface language.

/** Kept for an accepted action whose target could not be captured; the exporter asks to recreate it manually. */
export const REPRO_UNRESOLVED_ACTION = {
  captureFailed: 'Action target could not be captured; recreate this action manually.',
  captureInterrupted: 'Action capture interrupted by navigation; recreate this action manually.'
} as const

/** What comes before the address in a navigation step, longest first so one never shadows another. */
export const REPRO_NAVIGATION_PREFIXES = {
  navigateWithin: 'Navigate within the page to ',
  navigate: 'Navigate to ',
  open: 'Open '
} as const

/** How a step names its target, such as button “Sign in” or email input. */
export function reproTargetName(target: BrowserReproTarget): string {
  const kind = target.role || (target.tag === 'input' && target.inputType ? `${target.inputType} input` : target.tag)
  return target.label ? `${kind} “${target.label}”` : kind
}

export function reproClickText(target: BrowserReproTarget): string {
  return `Click ${reproTargetName(target)}`
}

export function reproInputText(target: BrowserReproTarget): string {
  return `Type in ${reproTargetName(target)} (value not recorded)`
}

export function reproKeyText(key: string, target: BrowserReproTarget): string {
  return `Press ${key} on ${reproTargetName(target)}`
}

export function reproScrollText(position: { x: number; y: number }): string {
  return `Scroll to x=${position.x}, y=${position.y}`
}

export function reproExpectText(condition: string): string {
  return `Expected result: ${condition}`
}

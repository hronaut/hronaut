import {
  REPRO_NAVIGATION_PREFIXES,
  REPRO_UNRESOLVED_ACTION,
  reproClickText,
  reproExpectText,
  reproInputText,
  reproKeyText,
  reproScrollText
} from '../../../../../shared/repro-step-text.js'
import type { BrowserReproStep, BrowserReproTarget } from '../../../../../shared/types.js'

type Translate = (key: string, parameters?: Record<string, unknown>) => string

const STEP_KINDS = new Set(['navigate', 'click', 'input', 'key', 'scroll', 'expect'])
const CONDITIONS = new Set(['visible', 'hidden', 'text', 'checked', 'unchecked', 'count', 'urlPath'])

/**
 * Names repro steps in the interface language. Main records each step in English (src/shared/repro-step-text.ts),
 * and MCP results and copied timelines keep that text. A step whose description is not one of those sentences for
 * its own fields, such as one whose sentence redaction changed while it was recorded, shows as recorded.
 */
export function createReproStepLabels(translate: Translate) {
  function kind(step: BrowserReproStep): string {
    return STEP_KINDS.has(step.kind) ? translate(`reproSteps.kinds.${step.kind}`) : step.kind
  }

  function targetName(target: BrowserReproTarget): string {
    const kindName = target.role
      || (target.tag === 'input' && target.inputType ? translate('reproSteps.targets.input', { type: target.inputType }) : target.tag)
    return target.label ? translate('reproSteps.targets.labelled', { kind: kindName, label: target.label }) : kindName
  }

  function navigation(text: string): string | undefined {
    for (const [key, prefix] of Object.entries(REPRO_NAVIGATION_PREFIXES)) {
      if (text.startsWith(prefix) && text.length > prefix.length) return translate(`reproSteps.steps.${key}`, { url: text.slice(prefix.length) })
    }
    return undefined
  }

  function description(step: BrowserReproStep): string {
    const text = step.description
    const target = step.target
    const condition = step.expectation?.condition
    if (text === REPRO_UNRESOLVED_ACTION.captureFailed) return translate('reproSteps.steps.captureFailed')
    if (text === REPRO_UNRESOLVED_ACTION.captureInterrupted) return translate('reproSteps.steps.captureInterrupted')
    if (step.kind === 'navigate') return navigation(text) ?? text
    if (step.kind === 'click' && target && text === reproClickText(target)) {
      return translate('reproSteps.steps.click', { target: targetName(target) })
    }
    if (step.kind === 'input' && target && text === reproInputText(target)) {
      return translate('reproSteps.steps.input', { target: targetName(target) })
    }
    if (step.kind === 'key' && target && step.key && text === reproKeyText(step.key, target)) {
      return translate('reproSteps.steps.key', { key: step.key, target: targetName(target) })
    }
    if (step.kind === 'scroll' && step.scroll && text === reproScrollText(step.scroll)) {
      return translate('reproSteps.steps.scroll', { x: step.scroll.x, y: step.scroll.y })
    }
    if (step.kind === 'expect' && condition && CONDITIONS.has(condition) && text === reproExpectText(condition)) {
      return translate('reproSteps.steps.expect', { condition: translate(`reproSteps.conditions.${condition}`) })
    }
    return text
  }

  /** The checkpoint condition as the Condition menu names it; a condition this version does not know shows as recorded. */
  function condition(value: string): string {
    return CONDITIONS.has(value) ? translate(`repro.checkpoint.${value}`) : value
  }

  return { kind, description, condition }
}

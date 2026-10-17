import type { AgentRecentStep } from './agent-presence.js'
import { agentStepTakesTarget, type AgentStepKind } from './agent-steps.js'

type Translate = (key: string, values?: Record<string, unknown>) => string

/**
 * A step in plain words, naming what it acts on when main knows it: Clicking "Review order" while it runs,
 * Clicked "Review order" once it finished. Without a target it falls back to the general phrase.
 */
export function agentStepText(t: Translate, step: AgentStepKind, target: string | undefined, tense: 'now' | 'done'): string {
  const scope = tense === 'now' ? 'shell.agents' : 'shell.agentCard'
  return target && agentStepTakesTarget(step) ? t(`${scope}.targetSteps.${step}`, { target }) : t(`${scope}.steps.${step}`)
}

/** A finished step in plain words; your answer to the agent's request says how you answered, such as You handed it back. */
export function agentFinishedStepText(t: Translate, step: Pick<AgentRecentStep, 'step' | 'target' | 'answer'>): string {
  return step.answer ? t(`shell.agentCard.answers.${step.answer}`) : agentStepText(t, step.step, step.target, 'done')
}

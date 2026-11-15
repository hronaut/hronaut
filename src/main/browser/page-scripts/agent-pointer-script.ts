import { pageScript } from '../../../shared/page-script.js'
import { agentPointerInPage, dismissAgentPointerInPage, type AgentPointerEffect, type AgentPointerIdentity } from './agent-pointer.page.js'

export type { AgentPointerEffect, AgentPointerIdentity } from './agent-pointer.page.js'

/**
 * Takes an agent's cursor off the page and resolves once the page has painted without it, or at once
 * when there is none. Only Hronaut's own hosts, which sit directly under the root element, are removed.
 */
export function dismissAgentPointerScript(): string {
  return pageScript(dismissAgentPointerInPage)
}

/** How long an agent's cursor stays after it arrives, and how long it takes to fade out. */
export const AGENT_POINTER_IDLE_MS = 2_000
export const AGENT_POINTER_FADE_MS = 320

/**
 * Draws an agent's cursor on the page, in its own isolated world: it glides from where it is to the point
 * in 600 to 900 ms, carries the agent's name in its avatar's color, and fades after two idle seconds. A click
 * or the start of a drag leaves a ripple at the point at once, since the input itself does not wait for the
 * glide; the end of a drag waits for the cursor to reach the drag's start, and holds it pressed until it
 * arrives.
 */
export function agentPointerScript(
  point: { x: number; y: number },
  effect: AgentPointerEffect,
  origin?: { x: number; y: number },
  agent?: AgentPointerIdentity
): string {
  return pageScript(agentPointerInPage, point, effect, origin ?? null, agent ?? null, AGENT_POINTER_IDLE_MS, AGENT_POINTER_FADE_MS)
}

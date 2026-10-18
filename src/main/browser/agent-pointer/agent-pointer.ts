import type { WebContents } from 'electron'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { agentPointerScript, dismissAgentPointerScript, type AgentPointerIdentity } from '../page-scripts.js'
import type { AgentPointerAccess } from './agent-pointer-access.js'

/** The isolated world the agent's cursor is drawn in, apart from the page's own scripts. */
const AGENT_POINTER_WORLD_ID = ISOLATED_WORLDS.agentPointer

/**
 * Draws the agent's cursor on the page, named and in its avatar's color when the call came from an MCP
 * client. Nothing is drawn while agent cursors are turned off. The page gets only the point, the effect,
 * the name and two colors, in an isolated world.
 */
export async function showAgentPointer(
  access: AgentPointerAccess,
  webContents: WebContents,
  point: { x: number; y: number },
  effect: 'move' | 'click' | 'drag-start' | 'drag-end',
  options: { origin?: { x: number; y: number }; agent?: AgentPointerIdentity } = {}
): Promise<void> {
  if (access.options().getShowAgentCursor?.() === false) return
  await webContents.executeJavaScriptInIsolatedWorld(
    AGENT_POINTER_WORLD_ID,
    [{ code: agentPointerScript(point, effect, options.origin, options.agent) }],
    false
  ).catch(() => undefined)
}

/**
 * Takes an agent's cursor off the page before a capture for an agent, so its screenshots and visual
 * comparisons show the page itself. Waits for the page to paint without it, at most a moment.
 */
export async function dismissAgentPointer(webContents: WebContents): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    webContents.executeJavaScriptInIsolatedWorld(AGENT_POINTER_WORLD_ID, [{ code: dismissAgentPointerScript() }], false).catch(() => undefined),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, 300) })
  ])
  clearTimeout(timer)
}

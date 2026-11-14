import { LocalizedError } from '../../localized-error.js'
import type { Browser } from '../browser.js'

/**
 * What the person pastes into an agent's chat so the agent continues in one of their open workspaces: the MCP call
 * that resumes it, with the workspace's ID and private resume key. Agents read English, so it stays English whatever
 * the interface language. The key goes from here to the clipboard and is never sent to a renderer.
 */
export function workspaceAgentKeyText(browser: Browser, workspaceId: string): string {
  const workspace = browser.mcpTabGroups.get(workspaceId)
  if (!workspace) {
    throw new LocalizedError('appErrors.workspace.unavailable', undefined, { message: `Unknown workspace: ${workspaceId}` })
  }
  // A workspace with direct agent access off cannot be resumed, so its key would not work.
  if (!browser.isWorkspaceAgentAccessible(workspaceId)) throw new LocalizedError('appErrors.workspace.agentAccessOff')
  const call = { action: 'resume', workspaceId, resumeKey: browser.mcpWorkspaceResumeKey(workspaceId) }
  return `Continue in my Hronaut workspace ${JSON.stringify(workspace.name)}: call browser_workspaces with ${JSON.stringify(call)} `
    + 'and keep working there instead of creating a new workspace. Keep the resumeKey private.'
}

/** Copies the text that hands an open workspace to an agent, for the person to paste into the agent's chat. */
export async function copyWorkspaceAgentKey(browser: Browser, workspaceId: string): Promise<void> {
  await browser.options.copyText(workspaceAgentKeyText(browser, workspaceId))
}

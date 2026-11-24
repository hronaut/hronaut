import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../shared/types.js'
import { mcpWorkspaceTab } from './tool-results.js'

// An agent working in one tab of its workspace does not see what happens in the others: a page there may show a
// dialog that holds it, its renderer may crash or hang, or the person may hand a tab back. The next result of a call
// in that workspace tells the agent, once for each such event.

type WorkspaceTab = BrowserState['tabs'][number]

/** The most events one session remembers having reported; the oldest are forgotten first. */
const REPORTED_LIMIT = 1_000

/** The event a tab shows now that an agent should hear about, with the key it is reported once under. */
function tabNotices(tab: ReturnType<typeof mcpWorkspaceTab<WorkspaceTab>>, resolvedTabId: string | undefined): { key: string; text: string }[] {
  const name = `Tab ${tab.id} (${JSON.stringify(tab.title || tab.url)})`
  const notices: { key: string; text: string }[] = []
  // The call's own tab already says so in its result, every time: see withWebsiteDialogNote.
  if (tab.dialog && tab.id !== resolvedTabId) {
    notices.push({ key: `dialog:${tab.dialog.id}`, text: `${name} shows a website ${tab.dialog.type}: ${JSON.stringify(tab.dialog.message)}. `
      + `Its page answers nothing else until the dialog is answered; answer it with browser_dialog, tabId "${tab.id}" and dialogId "${tab.dialog.id}".` })
  }
  const problem = tab.pageProblem
  if (problem?.kind === 'renderer-gone') {
    const cause = [problem.reason, problem.exitCode === undefined ? undefined : `exit code ${problem.exitCode}`].filter(Boolean).join(', ')
    notices.push({ key: `crash:${tab.id}:${tab.navigationGeneration}:${tab.documentGeneration ?? 0}:${cause}`,
      text: `${name}: its page stopped working${cause ? ` (${cause})` : ''}. `
        + 'Reload it with browser_history action "reload", or close it with browser_close_tab.' })
  } else if (problem?.kind === 'unresponsive') {
    notices.push({ key: `hang:${tab.id}:${tab.navigationGeneration}:${tab.documentGeneration ?? 0}`,
      text: `${name}: its page stopped responding. Wait and check it again with browser_snapshot, or reload it with browser_history action "reload".` })
  }
  if (tab.handedBack) notices.push({ key: `handed-back:${tab.id}:${tab.handedBack.at}`, text: `${name}: ${tab.handedBack.note}` })
  return notices
}

/**
 * What one MCP session has told its agent about its workspaces' tabs. Each session's server makes its own, so a
 * second agent in the same workspace hears of the same events too.
 */
export function createWorkspaceNotices() {
  const reported = new Set<string>()
  const remember = (key: string): void => {
    reported.add(key)
    if (reported.size > REPORTED_LIMIT) reported.delete(reported.values().next().value!)
  }
  return {
    /**
     * The result with a note of each event in the workspace's tabs that this session has not heard of yet. Only tabs
     * whose state the agent may list now, as browser_tabs does, count; the others wait for a later call.
     */
    withNotices(result: CallToolResult, state: BrowserState, options: {
      workspaceId: string
      resolvedTabId: string | undefined
      omitUrlDetail: boolean
      requireActiveCapabilityDispatch: (name: string, input: Record<string, unknown>, target: { workspaceId: string; tabId: string }) => unknown
    }): CallToolResult {
      const { workspaceId } = options
      const readable = (tabId: string): boolean => {
        try {
          options.requireActiveCapabilityDispatch('browser_tabs', { workspaceId }, { workspaceId, tabId })
          return true
        } catch { return false }
      }
      const fresh: string[] = []
      for (const tab of state.tabs) {
        const notices = tabNotices(mcpWorkspaceTab(tab, options.omitUrlDetail), options.resolvedTabId).filter(notice => !reported.has(notice.key))
        if (!notices.length || !readable(tab.id)) continue
        for (const notice of notices) {
          remember(notice.key)
          fresh.push(notice.text)
        }
      }
      // A dialog the call's own result names is reported there.
      const ownDialog = state.tabs.find(tab => tab.id === options.resolvedTabId)?.dialog
      if (ownDialog) remember(`dialog:${ownDialog.id}`)
      if (!fresh.length) return result
      return { ...result, content: [...result.content, { type: 'text', text: `Meanwhile in this workspace:\n- ${fresh.join('\n- ')}` }] }
    },
    /** A hand back the agent read in another result, as the attention request it waited on, so it is not told again. */
    heardHandBack(tabId: string, at: number): void {
      remember(`handed-back:${tabId}:${at}`)
    }
  }
}

export type WorkspaceNotices = ReturnType<typeof createWorkspaceNotices>

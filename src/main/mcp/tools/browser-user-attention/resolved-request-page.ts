import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { snapshotDetails } from '../../../browser/page-snapshots/page-snapshots.js'
import { getMcpGroupState } from '../../../browser/workspace-scope/workspace-scope.js'
import { mcpWorkspaceTab, urlDetailOmitted } from '../../tool-results.js'
import type { McpToolContext } from '../tool-context.js'

// An agent that waited for the person to sign in or solve a step learned only that they were done, and read the page
// with its next call. The result that tells it the person resolved the request now holds the tab's page as well: its
// address, title and the note of what changed while the person had it, and a snapshot as browser_snapshot takes it.

type PageContext = Pick<McpToolContext, 'manager' | 'requireActiveCapabilityDispatch' | 'workspaceNotices'>

/** The marks of the page a snapshot reads, which another load, a person's input or a take over in the meantime changes. */
function pageMark(tab: { url: string; navigationGeneration: number; documentGeneration?: number; humanInteractionGeneration?: number;
  agentPaused?: boolean }): string {
  return JSON.stringify([tab.url, tab.navigationGeneration, tab.documentGeneration ?? 0, tab.humanInteractionGeneration ?? 0, tab.agentPaused ?? false])
}

/**
 * The tab a resolved attention request named, as its agent may read it now: the tab's address, title, load state and
 * hand-back note, then a snapshot of its page. The snapshot is left out, with the reason, when the agent may not read
 * the page now or the page changed while it was read; `authorize` is the request's own access check, run again once
 * the page has been read.
 */
export async function resolvedRequestPage(context: PageContext, workspaceId: string, tabId: string,
  authorize: () => void): Promise<CallToolResult['content']> {
  const { manager } = context
  const current = () => getMcpGroupState(manager, workspaceId).tabs.find(candidate => candidate.id === tabId)
  const tab = current()
  if (!tab) return []
  const shown = mcpWorkspaceTab(tab, urlDetailOmitted(manager))
  const page = {
    tabId,
    url: shown.url,
    title: shown.title,
    loading: shown.loading,
    ...(shown.handedBack ? { handedBack: shown.handedBack } : {}),
    ...(shown.pageProblem ? { pageProblem: shown.pageProblem } : {}),
    ...(shown.urlDetail ? { urlDetail: shown.urlDetail } : {})
  }
  // The agent reads the note here, so the next result in the workspace does not tell it again.
  if (tab.handedBack) context.workspaceNotices.heardHandBack(tabId, tab.handedBack.at)
  const json = (value: unknown) => ({ type: 'text' as const, text: JSON.stringify(value, null, 2) })
  const target = { workspaceId, tabId }
  try {
    context.requireActiveCapabilityDispatch('browser_snapshot', target, target)
    const requireObservationWorkspace = manager.captureWorkspaceObservationGuard(workspaceId)
    const before = pageMark(tab)
    const snapshot = await snapshotDetails(manager, tabId)
    authorize()
    context.requireActiveCapabilityDispatch('browser_snapshot', target, target)
    requireObservationWorkspace()
    const after = current()
    if (!after || pageMark(after) !== before) throw new Error('The page changed while it was read. Read it again with browser_snapshot.')
    return [
      json({ page: { ...page, snapshot: { returnedChars: snapshot.returnedChars, truncated: snapshot.truncated } } }),
      { type: 'text', text: snapshot.text }
    ]
  } catch (error) {
    return [json({ page: { ...page, snapshot: { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) } } })]
  }
}

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { Browser } from '../../browser/browser.js'
import { snapshotDetails } from '../../browser/page-snapshots/page-snapshots.js'
import { getMcpGroupState } from '../../browser/workspace-scope/workspace-scope.js'
import { mcpWorkspaceTab, urlDetailOmitted } from '../tool-results.js'
import { pageObservationSettlement } from './page-observation-settlement.js'
import type { McpToolContext, WorkspaceToolCall } from './tool-context.js'

// What a tool that loads a page in a tab returns: the loaded tab alone, not the whole workspace, and by default a
// snapshot of the page it loaded, so an agent reads the page in the same call instead of asking for it next.

export type PageRead = 'snapshot' | 'none'

/** The fields a page-loading tool adds to its input to choose what it reads once the page loaded. */
export const pageReadInputSchema = {
  read: z.enum(['snapshot', 'none']).default('snapshot')
    .describe('What to read once the page loaded: snapshot (default) adds the browser_snapshot capture of the page; none returns only the tab.'),
  maxChars: z.number().int().min(1_000).max(100_000).optional()
    .describe('Bounded snapshot size, as in browser_snapshot.')
}

/** The call's settlement: a snapshot read is published only if the call still holds its target when it settles, as browser_snapshot's is. */
export function pageReadSettlement(manager: Browser, input: Record<string, unknown>) {
  return input.read === 'none' ? undefined : pageObservationSettlement(manager)
}

/** The loaded tab as agents read it: its address, title and load state, with the page problem or certificate warning it shows. */
function loadedTab(manager: Browser, workspaceId: string, tabId: string): Record<string, unknown> {
  const tab = getMcpGroupState(manager, workspaceId).tabs.find(candidate => candidate.id === tabId)
  if (!tab) throw new Error(`Tab not found: ${tabId}`)
  const shown = mcpWorkspaceTab(tab, urlDetailOmitted(manager))
  return {
    tabId: shown.id,
    url: shown.url,
    title: shown.title,
    loading: shown.loading,
    canGoBack: shown.canGoBack,
    canGoForward: shown.canGoForward,
    ...(shown.pageProblem ? { pageProblem: shown.pageProblem } : {}),
    ...(shown.untrustedCertificate ? { untrustedCertificate: true } : {}),
    ...(shown.urlDetail ? { urlDetail: shown.urlDetail } : {})
  }
}

/**
 * The result of a call that loaded a page in its tab: the tab, then, unless the call asked for none, a snapshot of the
 * page as browser_snapshot captures it. A snapshot the call may not take, or one that fails, as when the page moves on
 * while it is read, leaves the load's result standing and says why it is missing.
 */
export async function pageLoadResult(
  context: Pick<McpToolContext, 'manager' | 'requireActiveCapabilityDispatch'>,
  call: WorkspaceToolCall<unknown>,
  input: { read?: PageRead; maxChars?: number }
): Promise<CallToolResult> {
  const { manager } = context
  const tabId = call.tabId
  if (!tabId) throw new Error('A page load result needs its tab')
  const json = (value: unknown) => ({ type: 'text' as const, text: JSON.stringify(value, null, 2) })
  if (input.read === 'none') return { content: [json(loadedTab(manager, call.workspaceId, tabId))] }
  let snapshot: Awaited<ReturnType<typeof snapshotDetails>> | undefined
  let unavailable: string | undefined
  try {
    call.requireCurrentTarget()
    context.requireActiveCapabilityDispatch('browser_snapshot', { workspaceId: call.workspaceId, tabId }, { workspaceId: call.workspaceId, tabId })
    snapshot = await snapshotDetails(manager, tabId, input.maxChars)
  } catch (error) {
    unavailable = error instanceof Error ? error.message : String(error)
  }
  // The tab as the snapshot found it, which a redirect while the page settled may have moved on.
  const page = loadedTab(manager, call.workspaceId, tabId)
  if (!snapshot) return { content: [json({ ...page, snapshot: { status: 'unavailable', reason: unavailable } })] }
  return {
    content: [
      json({ ...page, snapshot: { returnedChars: snapshot.returnedChars, truncated: snapshot.truncated } }),
      { type: 'text', text: snapshot.text }
    ]
  }
}

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { recheckOpenedTabs, type TabsOpenedDuringClick } from '../../../browser/click-opened-tabs.js'
import { type NativeClickProgress, nativeClickEffectsPossible } from '../../../browser/native-click-admission.js'
import type { BrowserTabsManager } from '../../../browser/tabs-manager.js'
import { McpCapabilityAuthorizationError } from '../../capability-profile-store.js'
import { errorResult, nativeClickFailureResult } from '../../tool-results.js'
import type { ToolActivityClassification, WorkspaceToolCall } from '../tool-context.js'

function withCurrentOpenedTabs(result: CallToolResult, isCurrent: (tabId: string) => boolean): CallToolResult {
  if (result.isError) return result
  return {
    ...result,
    content: result.content.map(item => {
      if (item.type !== 'text') return item
      try {
        const value = JSON.parse(item.text) as { tabsOpenedDuringClick?: TabsOpenedDuringClick }
        const report = value?.tabsOpenedDuringClick
        if (!report || !Array.isArray(report.tabIds)) return item
        return { ...item, text: JSON.stringify({ ...value, tabsOpenedDuringClick: recheckOpenedTabs(report, isCurrent) }, null, 2) }
      } catch { return item }
    })
  }
}

/**
 * How a click settles. Once native click progress is recorded, the click may have had effects: a failure from then
 * on reports what may have happened, and a success is published only if the call still holds its target (and, for
 * a right click, the menu authority it retained). Tabs the click opened are reported only while they are still in
 * the workspace.
 */
export function clickSettlement(manager: BrowserTabsManager, rightClick: boolean) {
  let progress: NativeClickProgress | undefined
  let authority: { validate(): void; dispose(): void } | undefined
  let policy: Record<string, unknown> | undefined
  let reviewFinalizationFailed = false
  let call: WorkspaceToolCall<unknown> | undefined
  let publication: (() => void) | undefined
  let finishActivity: ((result: CallToolResult) => void) | undefined
  let finishing = false
  const settle = (result: CallToolResult, clickProgress: NativeClickProgress): CallToolResult => {
    let settled = result
    try {
      if (!result.isError) {
        if (!publication) throw new Error('Click publication guard is unavailable')
        if (rightClick && !authority) throw new Error('Right-click publication authority is unavailable')
        authority?.validate()
        publication()
      }
    } catch (error) { call!.rememberInputPolicy(error); settled = errorResult(error) }
    if (settled.isError) settled = nativeClickFailureResult(clickProgress,
      typeof settled.structuredContent?.reason === 'string' ? settled.structuredContent.reason : undefined,
      reviewFinalizationFailed, policy)
    finishActivity?.(settled)
    return settled
  }
  return {
    retainAuthority: (retained: { validate(): void; dispose(): void }): void => { authority = retained },
    recordProgress: (next: NativeClickProgress): void => { progress = { ...next } },
    prepare: (admitted: WorkspaceToolCall<unknown>): void => {
      call = admitted
      publication = () => {
        if (admitted.signal?.aborted) throw new Error('Click cancelled after preparation')
        admitted.requireCurrentTarget()
        admitted.requirePostWriteContext()
        if (admitted.authorityRejection()) throw new Error('Click authority changed after preparation')
      }
    },
    rememberInputPolicy: (error: unknown): void => {
      if (progress && error instanceof McpCapabilityAuthorizationError) policy = { permission: 'denied', policyDecision: error.decision }
    },
    inputPolicy: (): Record<string, unknown> | undefined => policy,
    reviewFinalizationFailed: (): void => { if (progress) reviewFinalizationFailed = true },
    deferActivity: (finish: (result: CallToolResult) => void): boolean => {
      if (!progress || finishing) return false
      finishActivity = settled => { finishing = true; finish(settled) }
      return true
    },
    settleDenied: (denied: CallToolResult): CallToolResult | undefined => progress ? settle(denied, progress) : undefined,
    publish: (result: CallToolResult): CallToolResult | undefined => progress ? settle(result, progress) : undefined,
    settleError: (error: unknown): CallToolResult | undefined => {
      if (!progress) return undefined
      call!.rememberInputPolicy(error)
      return settle(errorResult(error), progress)
    },
    classifyActivity: (activity: ToolActivityClassification, failed: boolean): ToolActivityClassification => progress ? {
      ...activity,
      dispatched: nativeClickEffectsPossible(progress),
      invalidatedOutcome: nativeClickEffectsPossible(progress) && failed ? 'outcome-unknown' : undefined
    } : activity,
    finalize: (result: CallToolResult): CallToolResult =>
      withCurrentOpenedTabs(result, tabId => manager.tabBelongsToMcpGroup(call!.workspaceId, tabId)),
    dispose: (): void => { authority?.dispose() }
  }
}

export type ClickSettlement = ReturnType<typeof clickSettlement>

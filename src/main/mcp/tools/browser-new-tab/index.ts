import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { DEFAULT_FONT_SIZE_LIMITS } from '../../../../shared/default-font-size.js'
import { MAX_TAB_LABEL_INPUT_LENGTH, normalizeTabLabel } from '../../../../shared/tab-label.js'
import { classifyMcpActivityResult, mcpWorkspaceState, textResult, toolDescription } from '../../tool-results.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'
import { type LabeledCreationSettlement, labeledCreationSettlement } from './labeled-creation-settlement.js'

export function registerBrowserNewTab(context: McpToolContext): void {
  const { manager, onTabActivity, registerWorkspaceTool, tool, workspaceAuthorizationError } = context
  registerWorkspaceTool(
    'browser_new_tab',
    {
      description: toolDescription('browser_new_tab'),
      inputSchema: {
        url: z.string().optional(),
        label: z.string().max(MAX_TAB_LABEL_INPUT_LENGTH).refine(value => { try { normalizeTabLabel(value); return true } catch { return false } }, 'Invalid tab label').optional().describe('Optional authored task label, at most 100 Unicode code points after trim/NFC. Not verified page identity. Creation reports label persistence separately.'),
        active: z.boolean().optional().describe('Select the new tab within the agent workspace; show it only while Follow agents is enabled.'),
        zoomIsolated: z.boolean().optional().describe('Give the new tab its own page zoom, starting at 100%, instead of sharing zoom with same-origin tabs. Set only at creation; it cannot be switched later.'),
        defaultFontSize: z.number().int().min(DEFAULT_FONT_SIZE_LIMITS.min).max(DEFAULT_FONT_SIZE_LIMITS.max).optional()
          .describe(`Browser default (standard) font size in CSS px for this tab, ${DEFAULT_FONT_SIZE_LIMITS.min}–${DEFAULT_FONT_SIZE_LIMITS.max}; the browser default is ${DEFAULT_FONT_SIZE_LIMITS.browserDefault}. Changes text sized by the browser default and em/rem media queries, unlike page zoom or OS text scale. Set only at creation; open another tab for another size.`)
      }
    },
    tool(async ({ workspaceId, url, active, label, zoomIsolated, defaultFontSize }: { workspaceId?: string; url?: string; active?: boolean; label?: string; zoomIsolated?: boolean; defaultFontSize?: number }, call: WorkspaceToolCall<LabeledCreationSettlement | undefined>) => {
      const construction = { ...(zoomIsolated ? { zoomIsolated: true } : {}), ...(defaultFontSize === undefined ? {} : { defaultFontSize }) }
      if (label !== undefined) {
        const creation = call.settlement!
        const validate = creation.publication()!
        validate()
        const saved = await manager.newLabeledAgentTab({ url, active, mcpGroupId: workspaceId!, focus: false, ...construction }, label, () => creation.publication()!(), tabId => {
          const activityId = randomUUID()
          onTabActivity?.({ activityId, tabId, toolName: 'browser_new_tab', phase: 'started', occurredAt: Date.now() }, workspaceId!)
          creation.retainPublication(() => {
            validate()
            if (!manager.tabBelongsToMcpGroup(workspaceId!, tabId)) throw workspaceAuthorizationError()
          })
          creation.retainFinish(result => onTabActivity?.({ activityId, tabId, toolName: 'browser_new_tab', phase: result.isError ? 'failed' : 'finished', occurredAt: Date.now(), result: classifyMcpActivityResult({ readOnly: false, dispatched: true, cancelled: creation.cancelled(), timedOut: false, threw: false, isError: result.isError === true, invalidatedOutcome: result.structuredContent?.status === 'OUTCOME_UNKNOWN' ? 'outcome-unknown' : undefined }) }, workspaceId!))
        }, creation.markAttempted)
        const knownNotSaved = saved.labelPersistence === 'not-saved'
        creation.recordLabelNotSaved(knownNotSaved)
        const outcome = { ...mcpWorkspaceState(manager.getMcpGroupState(workspaceId!)), ...saved,
          status: knownNotSaved ? 'LABEL_NOT_SAVED' : 'CREATED', retrySafe: false,
          ...(knownNotSaved ? { nextAction: 'The tab was created but its label was not saved. Inspect current state; do not repeat creation to retry the label.' } : {}) }
        return { ...textResult(outcome), structuredContent: { status: outcome.status }, ...(knownNotSaved ? { isError: true } : {}) }
      }
      const existingTabIds = new Set(manager.getState().tabs.map((tab) => tab.id))
      const next = await manager.newAgentTab({ url, active, mcpGroupId: workspaceId!, focus: false, ...construction })
      const createdTab = next.tabs.find((tab) => !existingTabIds.has(tab.id))
      if (createdTab) {
        const activityId = randomUUID()
        onTabActivity?.({ activityId, tabId: createdTab.id, toolName: 'browser_new_tab', phase: 'started', occurredAt: Date.now() }, workspaceId!)
        onTabActivity?.({ activityId, tabId: createdTab.id, toolName: 'browser_new_tab', phase: 'finished', occurredAt: Date.now() }, workspaceId!)
      }
      return textResult(mcpWorkspaceState(manager.getMcpGroupState(workspaceId!)))
    }),
    { settlement: input => input.label !== undefined ? labeledCreationSettlement(manager, input) : undefined }
  )
}

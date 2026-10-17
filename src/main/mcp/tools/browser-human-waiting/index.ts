import { z } from 'zod'
import { mcpCapabilityOperationClass } from '../../capability-classification.js'
import { humanWaitingArtifactHash } from '../../human-waiting-store.js'
import { textResult, toolDefinition, toolDescription } from '../../tool-results.js'
import { type ConsequentialReviewStepRequest, consequentialReviewSchema, workspaceIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserHumanWaiting(context: McpToolContext): void {
  const {
    activeWorkspaceIds,
    capabilityProfile,
    humanReviewSessionBinding,
    humanWaiting,
    manager,
    registerTool,
    requestUserAttention,
    requireActiveCapabilityDispatch,
    requireAgentWorkspace,
    reviewedActionArguments,
    savedWorkspaceIds,
    tool,
    workspaceAuthorizationError,
    workspaceToolInputSchemas
  } = context
  registerTool(
    'browser_human_waiting',
    {
      description: toolDescription('browser_human_waiting'),
      inputSchema: {
        workspaceId: workspaceIdSchema,
        action: z.enum(['request', 'list', 'cancel']).default('list'),
        runId: z.uuid().optional(),
        decision: z.enum(['review-page', 'approve-action', 'provide-input', 'resolve-unknown']).optional(),
        owner: z.string().trim().min(1).max(128).default('local-operator'),
        fallbackOwner: z.string().trim().min(1).max(128).default('local-operator'),
        timeoutMs: z.number().int().min(1).max(86_400_000).default(900_000),
        id: z.uuid().optional(), revision: z.uuid().optional(),
        review: consequentialReviewSchema.optional()
      }
    },
    tool(async (input: {
      workspaceId: string
      action: 'request' | 'list' | 'cancel'
      runId?: string
      decision?: 'review-page' | 'approve-action' | 'provide-input' | 'resolve-unknown'
      owner: string
      fallbackOwner: string
      timeoutMs: number
      id?: string
      revision?: string
      review?: ConsequentialReviewStepRequest | { steps: ConsequentialReviewStepRequest[] }
    }) => {
      const authorize = (): void => {
        if ((!activeWorkspaceIds.has(input.workspaceId) && !savedWorkspaceIds.has(input.workspaceId)) || !manager.isWorkspaceAgentAccessible(input.workspaceId)) throw workspaceAuthorizationError()
      }
      authorize()
      if (!humanWaiting) throw new Error('Human waiting storage is unavailable')
      if (input.action === 'list') return textResult(await humanWaiting.list(input.workspaceId, authorize))
      if (input.action === 'cancel') {
        if (!input.id || !input.revision) throw new Error('Decision ID and revision are required')
        return textResult(await humanWaiting.change(input.workspaceId, input.id, input.revision, 'cancel', authorize))
      }
      requireAgentWorkspace(input.workspaceId)
      if (!input.runId || !input.decision) throw new Error('Run ID and decision kind are required')
      if ((input.review !== undefined) !== (input.decision === 'approve-action')) {
        throw new Error('An approve-action request requires one consequential review artifact or bounded review group')
      }
      let reviewArtifact: import('../../../../shared/human-waiting.js').HumanWaitingReviewInput | undefined
      if (input.review) {
        const requestedSteps = 'steps' in input.review ? input.review.steps : [input.review]
        const grouped = requestedSteps.length > 1
        const workspace = manager.listMcpTabGroups().find(candidate => candidate.id === input.workspaceId)
        if (!workspace) throw workspaceAuthorizationError()
        const state = manager.getMcpGroupState(input.workspaceId)
        const steps = requestedSteps.map((requested): import('../../../../shared/human-waiting.js').HumanWaitingReviewStep => {
          const definition = toolDefinition(requested.toolName)
          if (!definition.annotations.destructiveHint) throw new Error('Consequential review is only available for mutating browser tools')
          if ('reviewId' in requested.arguments || 'reviewRevision' in requested.arguments) {
            throw new Error('A proposed action cannot include an existing review binding')
          }
          const schema = workspaceToolInputSchemas.get(requested.toolName)
          if (!schema) throw new Error('Consequential review target must be a workspace browser tool')
          const normalized = schema.parse(requested.arguments)
          if (normalized.workspaceId !== input.workspaceId) throw new Error('Reviewed action must target this workspace')
          requireActiveCapabilityDispatch(requested.toolName, normalized)
          if (grouped && (requested.toolName !== 'browser_click' || !normalized.postcondition || !requested.expectedPostcondition)) {
            throw new Error('Every grouped review step must be a browser_click with a declarative and human-readable postcondition')
          }
          const tabId = typeof normalized.tabId === 'string' ? normalized.tabId : state.activeTabId ?? undefined
          const tab = tabId ? state.tabs.find(candidate => candidate.id === tabId) : undefined
          if (tabId && !tab) throw workspaceAuthorizationError()
          if (grouped && !tab) throw new Error('Grouped review steps require one current page tab')
          let origin: string | undefined
          if (tab) {
            try {
              const url = new URL(tab.url)
              origin = url.origin === 'null' ? url.protocol : url.origin
            } catch { /* The visible tab remains reviewable without persisting a malformed URL. */ }
          }
          return {
            toolName: requested.toolName,
            actionClass: mcpCapabilityOperationClass(requested.toolName, normalized),
            reversibility: requested.reversibility,
            representation: requested.representation,
            ...(requested.description ? { description: requested.description } : {}),
            ...(requested.expectedPostcondition ? { expectedPostcondition: requested.expectedPostcondition } : {}),
            artifactHash: humanWaitingArtifactHash(requested.toolName, reviewedActionArguments(normalized, requested.toolName)),
            ...(origin ? { origin } : {}),
            ...(tab ? {
              tabId: tab.id,
              navigationGeneration: tab.navigationGeneration,
              humanInputGeneration: tab.humanInteractionGeneration ?? 0,
              browserSessionGeneration: tab.browserSessionGeneration ?? 0
            } : {})
          }
        })
        if (grouped && steps.some(step => step.tabId !== steps[0]!.tabId || step.origin !== steps[0]!.origin)) {
          throw new Error('Grouped review steps must target the same tab and origin')
        }
        reviewArtifact = {
          ...steps[0]!,
          sessionBinding: humanReviewSessionBinding,
          workspaceName: workspace.name,
          profileName: capabilityProfile?.name ?? 'Full access',
          ...(grouped ? { steps, currentStep: 0 } : {})
        }
      }
      if (reviewArtifact) {
        await humanWaiting.requireDispatch(input.workspaceId, authorize, undefined, humanReviewSessionBinding)
      }
      // Establish durable continuity recovery before asking for a human decision.
      if (!await manager.requireWorkspaceContinuityReview(input.workspaceId)) throw new Error('Workspace recovery could not be saved')
      authorize()
      const record = await humanWaiting.create({ workspaceId: input.workspaceId, runId: input.runId, decision: input.decision,
        owner: input.owner, fallbackOwner: input.fallbackOwner, timeoutMs: input.timeoutMs, priorOutcome: 'OUTCOME_UNKNOWN',
        ...(reviewArtifact ? { review: reviewArtifact } : {}) }, authorize)
      if (record.state !== 'WAITING_FOR_HUMAN') return textResult(record)
      return textResult(await humanWaiting.notify(input.workspaceId, record.id, authorize, async () => {
        await requestUserAttention({ workspaceId: input.workspaceId, reason: `Human decision required: ${input.decision}`, expiresAt: record.deadlineAt, humanWaitingDecisionId: record.id })
      }))
    })
  )
}

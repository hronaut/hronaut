import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { type PublicObservationOutcome, classifyPublicObservationOutcome, classifyWriterContextOutcome, summarizePublicOutcomeAssessment } from '../../../../shared/public-outcome.js'
import type { BrowserTabState } from '../../../../shared/types.js'
import type { BrowserTabsManager } from '../../../browser/tabs-manager.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema, workspaceIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function normalizePublicOutcomeTarget(value: string): URL {
  const parsed = new URL(value)
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
    throw new TypeError('targetUrl must be a credential-free HTTP or HTTPS address')
  }
  return parsed
}

export function publicOutcomeTargetFingerprint(key: Buffer, value: string): string {
  return createHmac('sha256', key)
    .update('hronaut-public-outcome-target-v1\0')
    .update(value)
    .digest('hex')
}

export function registerBrowserPublicOutcome(context: McpToolContext): void {
  const {
    manager,
    publicOutcomeFingerprintKey,
    registerWorkspaceTool,
    requireActiveCapabilityDispatch,
    requireAgentWorkspace,
    tabTool,
    workspaceAuthorizationError
  } = context
  registerWorkspaceTool(
    'browser_public_outcome',
    {
      description: toolDescription('browser_public_outcome'),
      inputSchema: {
        tabId: tabIdSchema,
        writerWorkspaceId: workspaceIdSchema
          .describe('Distinct standard workspace containing the writer-context read-back.'),
        writerTabId: tabIdSchema.describe('Exact writer-context tab.'),
        targetUrl: z.string().trim().min(1).max(2_048)
          .describe('Exact credential-free HTTP(S) target loaded in both tabs. Only a connection-keyed opaque fingerprint is returned.'),
        expectedText: z.string().trim().min(1).max(256).optional()
          .describe('Private required text checked independently in both contexts and never returned.'),
        expectedSelector: z.string().trim().min(1).max(512).optional()
          .describe('Private required visible selector checked independently in both contexts and never returned.')
      }
    },
    tabTool('browser_public_outcome', async (input: {
      workspaceId: string
      tabId: string
      writerWorkspaceId: string
      writerTabId: string
      targetUrl: string
      expectedText?: string
      expectedSelector?: string
    }) => {
      if (input.expectedText === undefined && input.expectedSelector === undefined) {
        throw new TypeError('expectedText or expectedSelector is required for a public-outcome receipt')
      }
      if (input.workspaceId === input.writerWorkspaceId) {
        throw new TypeError('Writer and public observer workspaces must be distinct')
      }
      const target = normalizePublicOutcomeTarget(input.targetUrl)
      const observerWorkspace = requireAgentWorkspace(input.workspaceId)
      const writerWorkspace = requireAgentWorkspace(input.writerWorkspaceId)
      if (observerWorkspace.contextClass !== 'public-observer') {
        throw new Error('browser_public_outcome requires a public-observer workspace as workspaceId')
      }
      if (writerWorkspace.contextClass !== 'standard') {
        throw new Error('browser_public_outcome requires a standard writer workspace')
      }
      if (!manager.tabBelongsToMcpGroup(input.workspaceId, input.tabId)
        || !manager.tabBelongsToMcpGroup(input.writerWorkspaceId, input.writerTabId)) {
        throw workspaceAuthorizationError()
      }
      const actionInput = input as unknown as Record<string, unknown>
      const authorizeWriter = (): void => {
        requireActiveCapabilityDispatch('browser_public_outcome', actionInput, {
          workspaceId: input.writerWorkspaceId,
          tabId: input.writerTabId,
          origins: [target.href]
        })
        requireAgentWorkspace(input.writerWorkspaceId)
        if (!manager.tabBelongsToMcpGroup(input.writerWorkspaceId, input.writerTabId)) {
          throw workspaceAuthorizationError()
        }
      }
      authorizeWriter()
      await manager.wakeTab(input.writerTabId)
      authorizeWriter()

      type Context = {
        tab: BrowserTabState
        contextClass: 'standard' | 'public-observer'
        exactTarget: boolean
      }
      const captureContext = (
        workspaceId: string,
        tabId: string,
        expectedClass: Context['contextClass']
      ): Context => {
        const state = manager.getMcpGroupState(workspaceId)
        const contextClass = state.mcpTabGroups[0]?.contextClass ?? 'standard'
        const tab = state.tabs.find(candidate => candidate.id === tabId)
        if (!tab || contextClass !== expectedClass) throw workspaceAuthorizationError()
        let exactTarget = false
        try { exactTarget = normalizePublicOutcomeTarget(tab.url).href === target.href } catch { /* mismatch */ }
        return { tab, contextClass, exactTarget }
      }
      const beforeWriter = captureContext(input.writerWorkspaceId, input.writerTabId, 'standard')
      const beforeObserver = captureContext(input.workspaceId, input.tabId, 'public-observer')
      const generations = (context: Context) => ({
        navigationGeneration: context.tab.navigationGeneration,
        observationGeneration: context.tab.observationGeneration ?? 0,
        humanInteractionGeneration: context.tab.humanInteractionGeneration ?? 0,
        browserSessionGeneration: context.tab.browserSessionGeneration ?? 0
      })
      const sameContext = (before: Context, after: Context | null): boolean => Boolean(
        after
        && before.contextClass === after.contextClass
        && before.tab.id === after.tab.id
        && before.tab.url === after.tab.url
        && before.exactTarget
        && after.exactTarget
        && before.tab.navigationGeneration === after.tab.navigationGeneration
        && (before.tab.observationGeneration ?? 0) === (after.tab.observationGeneration ?? 0)
        && (before.tab.humanInteractionGeneration ?? 0) === (after.tab.humanInteractionGeneration ?? 0)
        && (before.tab.browserSessionGeneration ?? 0) === (after.tab.browserSessionGeneration ?? 0)
      )
      const receipt = (
        writerAssessment: Awaited<ReturnType<BrowserTabsManager['observationQuality']>> | null,
        observerAssessment: Awaited<ReturnType<BrowserTabsManager['observationQuality']>> | null,
        writerStable: boolean,
        observerStable: boolean
      ) => {
        const observedAt = new Date().toISOString()
        const outcome = classifyPublicObservationOutcome(observerAssessment, writerStable && observerStable)
        const nextAction: Record<PublicObservationOutcome, string> = {
          publicly_observed: 'Use this bounded receipt only for the observed target and time; do not infer later availability or author identity.',
          not_publicly_observed: 'Do not repeat the write blindly. Inspect publication state or wait for an explicitly chosen later observation.',
          unknown: 'Resolve the observer barrier or ambiguity, then request a fresh observation without repeating the write.',
          reconciliation_required: 'Reconcile both exact tabs and target contexts before requesting a fresh observation; do not repeat the write.'
        }
        const freshness = (context: Context, stable: boolean, available: boolean) => ({
          status: stable ? (available ? 'fresh' : 'unavailable') : 'reconciliation_required',
          observedAt,
          generations: generations(context)
        })
        return {
          formatVersion: 1,
          observedAt,
          target: { fingerprint: publicOutcomeTargetFingerprint(publicOutcomeFingerprintKey, target.href) },
          outcome,
          writer: {
            contextClass: 'standard',
            outcome: writerStable ? classifyWriterContextOutcome(writerAssessment) : 'unknown',
            freshness: freshness(beforeWriter, writerStable, writerAssessment !== null),
            assessment: writerAssessment ? summarizePublicOutcomeAssessment(writerAssessment) : null
          },
          observer: {
            contextClass: 'public-observer',
            outcome,
            freshness: freshness(beforeObserver, observerStable, observerAssessment !== null),
            assessment: observerAssessment ? summarizePublicOutcomeAssessment(observerAssessment) : null
          },
          automaticRetryAllowed: false,
          nextAction: nextAction[outcome],
          caveats: [
            'This is one local browser observation, not proof of author identity or long-term availability.',
            'The receipt does not authorize a write, rollback, duplicate action, or automatic retry.',
            'Expected markers were checked privately; page content, credentials, cookies, and account identifiers are excluded.'
          ]
        }
      }
      if (!beforeWriter.exactTarget || !beforeObserver.exactTarget) {
        const result = receipt(null, null, false, false)
        return { ...textResult(result), structuredContent: result }
      }
      const [writerResult, observerResult] = await Promise.allSettled([
        manager.observationQuality({
          tabId: input.writerTabId,
          expectedOrigin: target.origin,
          expectedText: input.expectedText,
          expectedSelector: input.expectedSelector
        }),
        manager.observationQuality({
          tabId: input.tabId,
          expectedOrigin: target.origin,
          expectedText: input.expectedText,
          expectedSelector: input.expectedSelector
        })
      ])
      authorizeWriter()
      let afterWriter: Context | null = null
      let afterObserver: Context | null = null
      try { afterWriter = captureContext(input.writerWorkspaceId, input.writerTabId, 'standard') } catch { /* stale */ }
      try { afterObserver = captureContext(input.workspaceId, input.tabId, 'public-observer') } catch { /* stale */ }
      const result = receipt(
        writerResult.status === 'fulfilled' ? writerResult.value : null,
        observerResult.status === 'fulfilled' ? observerResult.value : null,
        sameContext(beforeWriter, afterWriter),
        sameContext(beforeObserver, afterObserver)
      )
      return { ...textResult(result), structuredContent: result }
    }),
    { continuityInspection: () => true }
  )
}

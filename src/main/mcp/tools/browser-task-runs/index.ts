import { createHash, createHmac } from 'node:crypto'
import { z } from 'zod'
import { taskReviewMetrics } from '../../task-review-metrics.js'
import type { SavedTaskDefinition, TaskRunCheckDefinition } from '../../task-run-store.js'
import { BROWSER_TOOL_METADATA } from '../../tool-catalog.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema, workspaceIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserTaskRuns(context: McpToolContext): void {
  const {
    activeWorkspaceIds,
    auditReceipts,
    client,
    humanWaiting,
    manager,
    registerTool,
    requireAgentWorkspace,
    savedTaskPreviewKey,
    savedWorkspaceIds,
    taskRuns,
    tool,
    workspaceAuthorizationError,
    workspaceLeases
  } = context
  registerTool(
    'browser_task_runs',
    {
      description: toolDescription('browser_task_runs'),
      inputSchema: {
        workspaceId: workspaceIdSchema.describe('Authorized workspace UUID. Start and heartbeat require an active workspace; retained runs may be inspected after archiving and resuming ownership.'),
        action: z.enum([
          'start', 'heartbeat', 'get', 'list', 'metrics', 'complete',
          'save', 'list-saved', 'preview', 'start-saved', 'delete-saved'
        ]).default('list'),
        taskRunId: z.uuid().optional(),
        taskDefinitionId: z.uuid().optional(),
        taskDefinitionRevision: z.uuid().optional(),
        revision: z.uuid().optional().describe('Latest optimistic revision returned by start, heartbeat, get, or list.'),
        deadlineMs: z.number().int().min(1_000).max(604_800_000).optional().describe('Overall run deadline, from one second through seven days.'),
        heartbeatTimeoutMs: z.number().int().min(1_000).max(86_400_000).optional().describe('Maximum silence between heartbeats, capped by the overall deadline.'),
        checks: z.array(z.discriminatedUnion('type', [
          z.object({ id: z.string().trim().min(1).max(32).regex(/^[a-zA-Z0-9_-]+$/), type: z.literal('page-settled'), tabId: tabIdSchema }).strict(),
          z.object({ id: z.string().trim().min(1).max(32).regex(/^[a-zA-Z0-9_-]+$/), type: z.literal('expected-origin'), tabId: tabIdSchema, expectedOrigin: z.string().url() }).strict(),
          z.object({ id: z.string().trim().min(1).max(32).regex(/^[a-zA-Z0-9_-]+$/), type: z.literal('audit-run'), runId: z.uuid() }).strict()
        ])).max(8).optional().describe('Typed completion checks. Expected origins are persisted only as fingerprints; audit references contain no artifact body.'),
        taskName: z.string().trim().min(1).max(80).optional(),
        intent: z.string().trim().min(1).max(280).optional(),
        taskInputs: z.array(z.object({
          name: z.string().trim().min(1).max(32).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
          type: z.enum(['string', 'number', 'boolean']),
          required: z.boolean(),
          sensitive: z.boolean()
        }).strict()).max(12).optional(),
        steps: z.array(z.object({
          id: z.string().trim().min(1).max(32).regex(/^[a-zA-Z0-9_-]+$/),
          kind: z.enum(['read-only', 'review-gated', 'mutation']),
          capability: z.string().trim().min(1).max(64).regex(/^(browser|wallet)_[a-z0-9_]+$/),
          humanGate: z.boolean()
        }).strict()).min(1).max(16).optional(),
        expectedEvidence: z.array(z.object({
          id: z.string().trim().min(1).max(32).regex(/^[a-zA-Z0-9_-]+$/),
          type: z.enum(['page-settled', 'expected-origin'])
        }).strict()).min(1).max(8).optional(),
        retryMaxAttempts: z.number().int().min(1).max(3).optional(),
        inputBindings: z.array(z.object({
          name: z.string().trim().min(1).max(32).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
          value: z.union([z.string().max(2_000), z.number().finite(), z.boolean()])
        }).strict()).max(12).optional(),
        tabId: tabIdSchema.optional(),
        expectedOrigin: z.string().url().optional(),
        previewToken: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        outcome: z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED', 'BLOCKED', 'OUTCOME_UNKNOWN']).optional()
      }
    },
    tool(async ({
      workspaceId, action, taskRunId, taskDefinitionId, taskDefinitionRevision, revision,
      deadlineMs, heartbeatTimeoutMs, checks, taskName, intent, taskInputs, steps,
      expectedEvidence, retryMaxAttempts, inputBindings, tabId, expectedOrigin, previewToken, outcome
    }: {
      workspaceId: string
      action: 'start' | 'heartbeat' | 'get' | 'list' | 'metrics' | 'complete'
        | 'save' | 'list-saved' | 'preview' | 'start-saved' | 'delete-saved'
      taskRunId?: string
      taskDefinitionId?: string
      taskDefinitionRevision?: string
      revision?: string
      deadlineMs?: number
      heartbeatTimeoutMs?: number
      checks?: Array<
        { id: string; type: 'page-settled'; tabId: string }
        | { id: string; type: 'expected-origin'; tabId: string; expectedOrigin: string }
        | { id: string; type: 'audit-run'; runId: string }
      >
      taskName?: string
      intent?: string
      taskInputs?: Array<{ name: string; type: 'string' | 'number' | 'boolean'; required: boolean; sensitive: boolean }>
      steps?: Array<{ id: string; kind: 'read-only' | 'review-gated' | 'mutation'; capability: string; humanGate: boolean }>
      expectedEvidence?: Array<{ id: string; type: 'page-settled' | 'expected-origin' }>
      retryMaxAttempts?: number
      inputBindings?: Array<{ name: string; value: string | number | boolean }>
      tabId?: string
      expectedOrigin?: string
      previewToken?: string
      outcome?: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'BLOCKED' | 'OUTCOME_UNKNOWN'
    }) => {
      if (!taskRuns) throw new Error('Task-run storage is unavailable')
      const authorizeActive = (): void => { requireAgentWorkspace(workspaceId) }
      const authorizeRetained = (): void => {
        if ((!activeWorkspaceIds.has(workspaceId) && !savedWorkspaceIds.has(workspaceId))
          || !manager.isWorkspaceAgentAccessible(workspaceId)) throw workspaceAuthorizationError()
      }
      const exactOrigin = (): URL => {
        if (!expectedOrigin) throw new TypeError(`expectedOrigin is required to ${action} a saved task`)
        const parsed = new URL(expectedOrigin)
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
          || expectedOrigin !== parsed.origin) throw new TypeError('Expected origin must be an exact HTTP(S) origin')
        return parsed
      }
      const requireDefinition = async (): Promise<SavedTaskDefinition> => {
        if (!taskDefinitionId) throw new TypeError(`taskDefinitionId is required to ${action} a saved task`)
        if (!taskDefinitionRevision) throw new TypeError(`taskDefinitionRevision is required to ${action} a saved task`)
        const definition = await taskRuns.getTask(workspaceId, taskDefinitionId, authorizeRetained)
        if (definition.revision !== taskDefinitionRevision) throw new Error('Saved task is unavailable or stale')
        return definition
      }
      const taskPreview = (definition: SavedTaskDefinition) => {
        authorizeActive()
        if (!tabId) throw new TypeError(`tabId is required to ${action} a saved task`)
        manager.requireTabInMcpGroup(workspaceId, tabId)
        const tab = manager.getMcpGroupState(workspaceId).tabs.find(candidate => candidate.id === tabId)
        if (!tab) throw new Error('Saved-task browser context is unavailable')
        const parsedOrigin = exactOrigin()
        const currentOrigin = (() => {
          try {
            const parsed = new URL(tab.url)
            return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : undefined
          } catch { return undefined }
        })()
        const bindings = inputBindings ?? []
        if (new Set(bindings.map(binding => binding.name)).size !== bindings.length) {
          throw new TypeError('Duplicate saved-task input binding')
        }
        const definitions = new Map(definition.inputs.map(input => [input.name, input]))
        for (const binding of bindings) {
          const declared = definitions.get(binding.name)
          if (!declared) throw new TypeError(`Unknown saved-task input: ${binding.name}`)
          if (typeof binding.value !== declared.type) throw new TypeError(`Saved-task input ${binding.name} must be ${declared.type}`)
        }
        const missingInputs = definition.inputs
          .filter(input => input.required && !bindings.some(binding => binding.name === input.name))
          .map(input => input.name)
        const lease = workspaceLeases.status(workspaceId, client.id)
        const originFingerprint = createHash('sha256').update(parsedOrigin.origin, 'utf8').digest('hex')
        const controlFingerprint = lease.status === 'owned' && lease.generation
          ? createHash('sha256').update('hronaut-saved-task-control-v1\0').update(lease.generation).digest('hex')
          : undefined
        const originStatus = currentOrigin === undefined ? 'unknown' : currentOrigin === parsedOrigin.origin ? 'matches' : 'changed'
        const status = missingInputs.length || !controlFingerprint || originStatus === 'unknown'
          ? 'reconciliation_required'
          : originStatus === 'changed' ? 'stale_context'
            : definition.steps.some(step => step.humanGate) ? 'needs_review' : 'ready'
        const inputDigests = bindings.map(binding => [
          binding.name,
          createHash('sha256').update('hronaut-saved-task-input-v1\0')
            .update(JSON.stringify([typeof binding.value, binding.value])).digest('hex')
        ] as [string, string]).sort((left, right) => left[0].localeCompare(right[0]))
        const token = controlFingerprint && originStatus === 'matches' && !missingInputs.length
          ? createHmac('sha256', savedTaskPreviewKey).update('hronaut-saved-task-preview-v1\0').update(JSON.stringify({
            taskId: definition.id,
            taskRevision: definition.revision,
            workspaceId,
            tabId,
            navigationGeneration: tab.navigationGeneration,
            observationGeneration: tab.observationGeneration ?? 0,
            originFingerprint,
            controlFingerprint,
            inputDigests
          })).digest('hex')
          : undefined
        return {
          task: { id: definition.id, revision: definition.revision, name: definition.name, intent: definition.intent },
          inputs: definition.inputs.map(input => ({
            name: input.name, type: input.type, required: input.required, sensitive: input.sensitive,
            provided: bindings.some(binding => binding.name === input.name)
          })),
          context: {
            workspaceId, tabId,
            navigationGeneration: tab.navigationGeneration,
            observationGeneration: tab.observationGeneration ?? 0,
            originStatus,
            controlStatus: lease.status
          },
          allowedCapabilities: [...new Set(definition.steps.map(step => step.capability))],
          steps: definition.steps,
          expectedEvidence: definition.evidence,
          humanGates: definition.steps.filter(step => step.humanGate).map(step => step.id),
          retryPolicy: definition.retryPolicy,
          status,
          canStart: token !== undefined,
          missingInputs,
          ...(token ? { previewToken: token, binding: { originFingerprint, controlFingerprint } } : {})
        }
      }
      if (action === 'save') {
        authorizeActive()
        if (!taskName || !intent || !steps?.length || !expectedEvidence?.length) {
          throw new TypeError('taskName, intent, steps, and expectedEvidence are required to save a task')
        }
        for (const step of steps) {
          if (!(step.capability in BROWSER_TOOL_METADATA)) throw new TypeError(`Unknown saved-task capability: ${step.capability}`)
        }
        return textResult(await taskRuns.saveTask({
          workspaceId,
          name: taskName,
          intent,
          inputs: taskInputs ?? [],
          steps,
          evidence: expectedEvidence,
          retryPolicy: { maxAttempts: retryMaxAttempts ?? 1, retryable: 'read-only-only' }
        }, authorizeActive))
      }
      if (action === 'list-saved') return textResult(await taskRuns.listTasks(workspaceId, authorizeRetained))
      if (action === 'delete-saved') {
        if (!taskDefinitionId || !taskDefinitionRevision) {
          throw new TypeError('taskDefinitionId and taskDefinitionRevision are required to delete a saved task')
        }
        return textResult(await taskRuns.deleteTask(
          workspaceId, taskDefinitionId, taskDefinitionRevision, authorizeRetained
        ))
      }
      if (action === 'preview' || action === 'start-saved') {
        const definition = await requireDefinition()
        const preview = taskPreview(definition)
        if (action === 'preview') {
          const { binding: _privateBinding, ...publicPreview } = preview
          return textResult(publicPreview)
        }
        if (!previewToken || preview.previewToken !== previewToken) {
          throw new Error('Saved-task preview is stale; preview the current browser context again')
        }
        const binding = preview.binding
        if (!preview.canStart || !binding?.controlFingerprint || !tabId) {
          throw new Error('Saved-task context requires reconciliation')
        }
        const definitions: TaskRunCheckDefinition[] = [
          {
            id: 'task_context', type: 'context-binding', tabId,
            navigationGeneration: preview.context.navigationGeneration,
            observationGeneration: preview.context.observationGeneration,
            originFingerprint: binding.originFingerprint,
            controlFingerprint: binding.controlFingerprint
          },
          ...definition.evidence.map(evidence => evidence.type === 'page-settled'
            ? { id: evidence.id, type: evidence.type, tabId } as const
            : { id: evidence.id, type: evidence.type, tabId, fingerprint: binding.originFingerprint } as const)
        ]
        const run = await taskRuns.createFromTask(
          workspaceId, definition.id, definition.revision,
          {
            deadlineMs: deadlineMs ?? 3_600_000,
            heartbeatTimeoutMs: heartbeatTimeoutMs ?? 60_000,
            checks: definitions
          },
          authorizeActive
        )
        return textResult(await taskRuns.heartbeat(
          workspaceId,
          run.id,
          run.revision,
          authorizeActive,
          async contextChecks => {
            let admissionStatus: 'PASS' | 'FAIL' | 'UNAVAILABLE' = 'UNAVAILABLE'
            try {
              const fresh = taskPreview(definition)
              admissionStatus = fresh.previewToken === previewToken ? 'PASS'
                : fresh.binding?.controlFingerprint ? 'FAIL' : 'UNAVAILABLE'
            } catch { /* The durable run must record unavailable admission evidence. */ }
            return {
              results: contextChecks.map(check => ({ id: check.id, status: admissionStatus })),
              contextToken: admissionStatus
            }
          }
        ))
      }
      if (action === 'start') {
        authorizeActive()
        const definitions: TaskRunCheckDefinition[] = (checks ?? []).map(check => {
          if (check.type === 'audit-run') return { id: check.id, type: check.type, artifactId: check.runId }
          manager.requireTabInMcpGroup(workspaceId, check.tabId)
          if (check.type === 'page-settled') return check
          const parsed = new URL(check.expectedOrigin)
          if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
            || check.expectedOrigin !== parsed.origin) throw new TypeError('Expected origin must be an exact HTTP(S) origin')
          return {
            id: check.id, type: check.type, tabId: check.tabId,
            fingerprint: createHash('sha256').update(parsed.origin, 'utf8').digest('hex')
          }
        })
        return textResult(await taskRuns.create({
          workspaceId,
          deadlineMs: deadlineMs ?? 3_600_000,
          heartbeatTimeoutMs: heartbeatTimeoutMs ?? 60_000,
          checks: definitions
        }, authorizeActive))
      }
      if (action === 'list') return textResult(await taskRuns.list(workspaceId, authorizeRetained))
      if (action === 'metrics') {
        if (!humanWaiting) throw new Error('Human waiting storage is unavailable')
        const runs = await taskRuns.list(workspaceId, authorizeRetained)
        const decisions = await humanWaiting.list(workspaceId, authorizeRetained)
        authorizeRetained()
        return textResult(taskReviewMetrics(workspaceId, runs, decisions))
      }
      if (!taskRunId) throw new TypeError(`taskRunId is required to ${action} a task run`)
      if (action === 'get') return textResult(await taskRuns.get(workspaceId, taskRunId, authorizeRetained))
      if (!revision) throw new TypeError(`revision is required to ${action} a task run`)
      const evaluate = async (definitions: TaskRunCheckDefinition[]) => {
        const results: Array<{ id: string; status: 'PASS' | 'FAIL' | 'UNAVAILABLE' }> = []
        const context: unknown[] = []
        for (const check of definitions) {
          if (check.type === 'context-binding') {
            let tab
            try {
              manager.requireTabInMcpGroup(workspaceId, check.tabId)
              tab = manager.getMcpGroupState(workspaceId).tabs.find(candidate => candidate.id === check.tabId)
            } catch { /* Report bounded unavailability below. */ }
            const lease = workspaceLeases.status(workspaceId, client.id)
            const controlFingerprint = lease.status === 'owned' && lease.generation
              ? createHash('sha256').update('hronaut-saved-task-control-v1\0').update(lease.generation).digest('hex')
              : undefined
            let originFingerprint: string | undefined
            if (tab) {
              try {
                const current = new URL(tab.url)
                if (['http:', 'https:'].includes(current.protocol)) {
                  originFingerprint = createHash('sha256').update(current.origin, 'utf8').digest('hex')
                }
              } catch { /* Report bounded unavailability below. */ }
            }
            const status = !tab || !originFingerprint || !controlFingerprint ? 'UNAVAILABLE'
              : tab.navigationGeneration === check.navigationGeneration
                && (tab.observationGeneration ?? 0) === check.observationGeneration
                && originFingerprint === check.originFingerprint
                && controlFingerprint === check.controlFingerprint ? 'PASS' : 'FAIL'
            results.push({ id: check.id, status })
            context.push([
              check.id, check.type, check.tabId,
              tab?.navigationGeneration ?? 'unavailable',
              tab?.observationGeneration ?? 'unavailable',
              originFingerprint ?? 'unavailable',
              controlFingerprint ?? 'unavailable'
            ])
            continue
          }
          if (check.type === 'audit-run') {
            try {
              if (!auditReceipts) throw new Error('Audit storage unavailable')
              const report = await auditReceipts.read(workspaceId, check.artifactId)
              const status = report.run.status === 'stopped' && report.run.persistenceFailed === false
                ? 'PASS' : report.run.status === 'recording' || report.run.status === 'stopping' ? 'FAIL' : 'UNAVAILABLE'
              results.push({ id: check.id, status })
              context.push([check.id, check.type, check.artifactId, report.run.status,
                report.run.stoppedAt, report.run.persistenceFailed, report.receipts.length])
            } catch {
              results.push({ id: check.id, status: 'UNAVAILABLE' })
              context.push([check.id, check.type, check.artifactId, 'unavailable'])
            }
            continue
          }
          let tab
          try {
            manager.requireTabInMcpGroup(workspaceId, check.tabId)
            tab = manager.getMcpGroupState(workspaceId).tabs.find(candidate => candidate.id === check.tabId)
          } catch { /* Report bounded unavailability below. */ }
          if (!tab) {
            results.push({ id: check.id, status: 'UNAVAILABLE' })
            context.push([check.id, check.type, check.tabId, 'unavailable'])
            continue
          }
          let originFingerprint = 'unavailable'
          try {
            const current = new URL(tab.url)
            if (['http:', 'https:'].includes(current.protocol)) {
              originFingerprint = createHash('sha256').update(current.origin, 'utf8').digest('hex')
            }
          } catch { /* Keep the bounded unavailable marker. */ }
          const settled = !tab.loading && !tab.sleeping
          results.push({
            id: check.id,
            status: check.type === 'page-settled' ? (settled ? 'PASS' : 'FAIL')
              : originFingerprint === 'unavailable' ? 'UNAVAILABLE'
                : originFingerprint === check.fingerprint ? 'PASS' : 'FAIL'
          })
          context.push([check.id, check.type, check.tabId, tab.navigationGeneration,
            tab.observationGeneration ?? 0, tab.loading, tab.sleeping, originFingerprint])
        }
        return {
          results,
          contextToken: createHash('sha256').update(JSON.stringify(context), 'utf8').digest('hex')
        }
      }
      if (action === 'heartbeat') {
        return textResult(await taskRuns.heartbeat(workspaceId, taskRunId, revision, authorizeActive, evaluate))
      }
      if (!outcome) throw new TypeError('outcome is required to complete a task run')
      return textResult(await taskRuns.complete(workspaceId, taskRunId, revision, outcome, authorizeActive, evaluate))
    })
  )
}

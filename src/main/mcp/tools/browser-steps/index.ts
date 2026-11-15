import { z } from 'zod'
import { MAX_BROWSER_KEY_PRESS_LENGTH, parseBrowserKeyPress } from '../../../../shared/keyboard-input.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'
import { agentCursorIdentity } from '../../agent-presence.js'
import { click } from '../../../browser/agent-page-actions/click.js'
import { select, type } from '../../../browser/agent-page-actions/form-input-and-scroll.js'
import { PASTE_KEY_REFUSAL, pastesClipboard, press } from '../../../browser/agent-keys/agent-keys.js'

const target = { ref: z.string().optional(), selector: z.string().optional() }

const stepSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('click'), ...target, doubleClick: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('type'), ...target, text: z.string().max(65_536), submit: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('select'), ...target, value: z.string().max(1024) }).strict(),
  z.object({
    action: z.literal('press'),
    key: z.string().min(1).max(MAX_BROWSER_KEY_PRESS_LENGTH)
      .refine(key => { try { return !pastesClipboard(parseBrowserKeyPress(key)) } catch { return true } }, PASTE_KEY_REFUSAL)
  }).strict(),
  z.object({ action: z.literal('wait'), ms: z.number().int().min(1).max(5_000) }).strict()
])

type Step = z.infer<typeof stepSchema>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Several clicks, typing, choices, key presses and short pauses on one tab in one call, each as its own tool would do
 * it, so an agent spends one round trip on a sequence it already knows. Stops at the first step that fails; steps
 * already done are not undone.
 */
export function registerBrowserSteps(context: McpToolContext): void {
  const { client, manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_steps',
    {
      description: toolDescription('browser_steps'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        steps: z.array(stepSchema).min(1).max(20)
          .describe('1 to 20 steps run in order on the same tab: click, type, select, press or wait.')
      }
    },
    tabTool('browser_steps', async ({ steps }: { tabId?: string; steps: Step[] }, call: WorkspaceToolCall) => {
      const tabId = call.tabId
      // Re-checks the call before every step and before each native input event within one.
      const validate = (validateContext: () => void = () => undefined): void => {
        if (call.signal?.aborted) throw new Error('Steps cancelled; steps already done are not undone')
        call.requireCurrentTarget()
        call.requirePostWriteContext()
        validateContext()
        if (call.authorityRejection()) throw new Error('Authority changed; inspect fresh state before continuing. Steps already done are not undone')
      }
      const results: Array<{ step: number; action: Step['action']; result: unknown }> = []
      for (const [index, step] of steps.entries()) {
        try {
          validate()
          let result: unknown
          if (step.action === 'click') {
            const clickTarget = { tabId, ref: step.ref, selector: step.selector, doubleClick: step.doubleClick }
            result = await click(manager, clickTarget, validate, undefined, undefined, agentCursorIdentity(client.name))
          } else if (step.action === 'type') {
            result = await type(manager, { tabId, ref: step.ref, selector: step.selector, text: step.text, submit: step.submit })
          } else if (step.action === 'select') {
            result = await select(manager, { tabId, ref: step.ref, selector: step.selector, value: step.value })
          } else if (step.action === 'press') {
            await press(manager, step.key, tabId, validate)
            result = `Pressed ${step.key}`
          } else {
            await new Promise<void>((resolve) => setTimeout(resolve, step.ms))
            result = `Waited ${step.ms} ms`
          }
          results.push({ step: index + 1, action: step.action, result })
        } catch (error) {
          call.rememberInputPolicy(error)
          // Steps that ran before the failing one changed the page: replaying the whole call would repeat them.
          const outcome = {
            status: 'STOPPED',
            detail: `Step ${index + 1} (${step.action}) failed: ${errorMessage(error)}`,
            completed: results.length,
            failedStep: index + 1,
            effects: results.length > 0 ? 'possible' : 'none',
            retrySafe: false,
            nextAction: 'Read the page before continuing. Steps already done are not undone; send only the steps still needed.',
            steps: results
          }
          return { ...textResult(outcome), structuredContent: outcome, isError: true }
        }
      }
      return textResult({ completed: results.length, steps: results })
    })
  )
}

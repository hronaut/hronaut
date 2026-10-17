import { z } from 'zod'
import { closedTabWaitResult, errorResult, textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserWait(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_wait',
    {
      description: toolDescription('browser_wait'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        text: z.union([
          z.string().min(1).max(1_000),
          z.array(z.string().min(1).max(1_000)).min(1).max(20)
        ]).optional()
          .describe('Wait until this text, or any of up to 20 candidate texts, is visible in the rendered page. Cannot be combined with textGone.'),
        textGone: z.string().min(1).max(1_000).optional()
          .describe('Wait until this exact text is absent from the rendered page. Cannot be combined with text.'),
        ref: z.string().min(1).max(100).optional()
          .describe('Snapshot element ref to wait for. Cannot be combined with selector, text, or textGone.'),
        selector: z.string().min(1).max(2_000).optional()
          .describe('CSS selector to wait for. Cannot be combined with ref, text, or textGone.'),
        state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional()
          .describe('Element state to wait for. Defaults to visible when ref or selector is provided.'),
        urlPattern: z.string().trim().min(1).max(2_048).optional()
          .describe('Full page URL wildcard pattern to wait for, including same-document route changes. Cannot be combined with text or an element target.'),
        timeoutMs: z.number().int().min(1).max(60_000).optional()
      }
    },
    tabTool('browser_wait', async ({ tabId, text, textGone, ref, selector, state, urlPattern, timeoutMs }: {
      tabId?: string
      text?: string | string[]
      textGone?: string
      ref?: string
      selector?: string
      state?: 'attached' | 'detached' | 'visible' | 'hidden'
      urlPattern?: string
      timeoutMs?: number
    }) => {
      try {
        if (text && textGone) throw new TypeError('Choose either text or textGone, not both.')
        const hasTarget = Boolean(ref || selector)
        if (urlPattern && (text || textGone || hasTarget || state)) {
          throw new TypeError('Choose one wait condition: urlPattern, page text, or an element target.')
        }
        if (hasTarget && (text || textGone)) throw new TypeError('Choose page text or an element target, not both.')
        if (state && !hasTarget) throw new TypeError('Provide ref or selector when waiting for an element state.')
        if (urlPattern) {
          const matchedUrl = await manager.waitForUrlPattern(urlPattern, tabId, timeoutMs)
          return matchedUrl
            ? textResult(`URL matched: ${matchedUrl}`)
            : errorResult(new Error('Timed out waiting for the page URL pattern.'))
        }
        if (hasTarget) {
          const elementState = state ?? 'visible'
          const matched = await manager.waitForElement({ ref, selector }, tabId, timeoutMs, elementState)
          const targetLabel = ref ? `[${ref}]` : selector!
          return matched
            ? textResult(`Element is ${elementState}: ${targetLabel}`)
            : errorResult(new Error(`Timed out waiting for element to become ${elementState}: ${targetLabel}`))
        }
        if (text) {
          const found = await manager.waitForText(text, tabId, timeoutMs, 'visible')
          if (found) return textResult(`Found text: ${found}`)
          return errorResult(new Error(Array.isArray(text)
            ? `Timed out waiting for any of ${text.length} requested texts.`
            : `Timed out waiting for text: ${text}`))
        }
        if (textGone) {
          const disappeared = await manager.waitForText(textGone, tabId, timeoutMs, 'hidden')
          return disappeared
            ? textResult(`Text disappeared: ${textGone}`)
            : errorResult(new Error(`Timed out waiting for text to disappear: ${textGone}`))
        }
        await manager.waitForPage(tabId, timeoutMs)
        return textResult('Page is no longer loading.')
      } catch (error) {
        const closedTabResult = closedTabWaitResult(error)
        if (closedTabResult) return closedTabResult
        throw error
      }
    }),
    { waitsOnTab: true }
  )
}

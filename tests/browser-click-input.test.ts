import { expect, it } from 'vitest'
import { z } from 'zod'
import { browserClickSchema } from '../src/main/mcp/browser-click-input.js'
import { browserActionPayloadFingerprint } from '../src/main/mcp/browser-action-authority.js'
import { humanWaitingArtifactHash } from '../src/main/mcp/human-waiting-store.js'

const schema = browserClickSchema({ tabId: z.string().optional(), button: z.enum(['left', 'right']).optional(),
  native: z.boolean().optional(), ref: z.string().optional(), selector: z.string().optional(),
  x: z.number().optional(), y: z.number().optional(), doubleClick: z.boolean().optional(),
  dialogAction: z.string().optional(), promptText: z.string().optional() })
const valid = { tabId: 'fixture-tab', selector: '#target', native: true, button: 'right' }
it.each([
  { tabId: undefined }, { native: undefined }, { native: false }, { ref: 'e1' }, { selector: undefined },
  { selector: '' }, { x: 1 }, { y: 1 }, { doubleClick: true }, { dialogAction: 'dismiss' }, { promptText: '' }, { modifiers: [] }
])('rejects unsupported right-click shape %j before dispatch', change => {
  expect(schema.safeParse({ ...valid, ...change }).success).toBe(false)
})
it('preserves legacy omitted-button parsing and distinguishes button-bound authority', () => {
  const legacy = { tabId: 'fixture-tab', selector: '#target', native: true }
  const source = { ...legacy, oldIgnoredField: true }
  expect(schema.parse(source)).toEqual(legacy)
  expect(source.oldIgnoredField).toBe(true)
  const calls = [legacy, { ...legacy, button: 'left' }, valid].map(input => schema.parse(input))
  expect(new Set(calls.map(browserActionPayloadFingerprint)).size).toBe(3)
  expect(new Set(calls.map(input => humanWaitingArtifactHash('browser_click', input))).size).toBe(3)
})

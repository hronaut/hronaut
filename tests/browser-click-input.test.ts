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

const modifierSchema = browserClickSchema({ tabId: z.string().optional(), button: z.enum(['left', 'right']).optional(),
  native: z.boolean().optional(), ref: z.string().optional(), selector: z.string().optional(),
  x: z.number().optional(), y: z.number().optional(), doubleClick: z.boolean().optional(),
  dialogAction: z.string().optional(), promptText: z.string().optional(),
  modifiers: z.array(z.enum(['Shift', 'Control', 'Meta', 'ControlOrMeta'])).min(1).max(3).optional() })
const modified = { selector: '#row', native: true, modifiers: ['Shift'] }
it.each([
  { native: undefined }, { native: false }, { ref: 'e1' }, { selector: undefined }, { selector: undefined, x: 1, y: 1 },
  { doubleClick: true }, { button: 'right', tabId: 'fixture-tab' }, { dialogAction: 'accept' }, { promptText: '' },
  { modifiers: [] }, { modifiers: ['Shift', 'Shift'] }, { modifiers: ['Alt'] }, { modifiers: ['Shift', 'Control', 'Meta', 'ControlOrMeta'] }
])('rejects unsupported modifier click shape %j before dispatch', change => {
  expect(modifierSchema.safeParse({ ...modified, ...change }).success).toBe(false)
})
it('keeps modifiers in the parsed call so a plain click review cannot authorize a modified one', () => {
  const plain = modifierSchema.parse({ selector: '#row', native: true })
  const shift = modifierSchema.parse(modified)
  const control = modifierSchema.parse({ ...modified, modifiers: ['ControlOrMeta'], button: 'left' })
  expect(shift).toEqual(modified)
  expect(new Set([plain, shift, control].map(browserActionPayloadFingerprint)).size).toBe(3)
  expect(new Set([plain, shift, control].map(input => humanWaitingArtifactHash('browser_click', input))).size).toBe(3)
})

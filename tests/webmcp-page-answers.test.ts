import { describe, expect, it } from 'vitest'
import { webMcpCallFromPage, webMcpListingFromPage, webMcpStatusFromPage } from '../src/main/browser/webmcp/webmcp-page-answers.js'
import { WEBMCP_LIMITS } from '../src/main/browser/webmcp-bridge.js'

/** JSON with sorted keys, as the bridge writes its descriptor. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

function nested(depth: number): unknown {
  let value: unknown = { type: 'string' }
  for (let level = 0; level < depth; level++) value = { items: value }
  return value
}

const tool = { annotations: { readOnlyHint: true }, description: 'Reads a value.', inputSchema: { type: 'object' }, name: 'read', title: 'Read' }
const invalid = { listed: false, supported: true, reason: 'The page did not return a valid WebMCP descriptor', status: 'WEBMCP_ERROR' }
const unknownOutcome = {
  supported: true, status: 'WEBMCP_ERROR', dispatch: 'possibly-dispatched', effects: 'possible', retrySafe: false,
  reason: 'The page returned no valid WebMCP outcome'
}
const resultOf = (result: unknown): unknown => (webMcpCallFromPage({ supported: true, status: 'TOOL_RETURNED', result }) as { result: unknown }).result

describe('what main takes from the WebMCP page bridge, which runs where the page can change it', () => {
  it('keeps whether the page supports WebMCP and a bounded reason, nothing else', () => {
    expect(webMcpStatusFromPage({ supported: true, reason: 'x'.repeat(10_000), tabId: 'spoofed' })).toEqual({ supported: true, reason: 'x'.repeat(500) })
    expect(webMcpStatusFromPage({ supported: 'yes', reason: { nested: true } })).toEqual({ supported: false })
    expect(webMcpStatusFromPage(undefined)).toEqual({ supported: false })
  })

  it('lists the tools parsed from the descriptor JSON it digests, not tools the page names beside it', () => {
    const descriptorJson = canonical([tool, { name: 'write' }])
    expect(webMcpListingFromPage({ supported: true, descriptorJson, descriptors: [{ name: 'other' }], workspaceId: 'spoofed' })).toEqual({
      listed: true, descriptorJson, tools: [tool, { name: 'write' }]
    })
    const deepest = canonical([{ name: 'deep', inputSchema: nested(63) }])
    expect(webMcpListingFromPage({ supported: true, descriptorJson: deepest })).toMatchObject({ listed: true })
  })

  it('refuses descriptor JSON the bridge would not give: past its limits, of another shape or form, or not JSON', () => {
    const many = Array.from({ length: WEBMCP_LIMITS.maxTools + 1 }, (_, index) => ({ name: `tool-${index}` }))
    for (const descriptors of [
      many,
      [{ name: 'n'.repeat(WEBMCP_LIMITS.maxNameChars + 1) }],
      [{ name: '' }],
      [{ name: 'read', title: 't'.repeat(WEBMCP_LIMITS.maxTitleChars + 1) }],
      [{ name: 'read', description: 'd'.repeat(WEBMCP_LIMITS.maxDescriptionChars + 1) }],
      [{ name: 'read', inputSchema: { description: 's'.repeat(WEBMCP_LIMITS.maxSchemaChars) } }],
      [{ name: 'read', inputSchema: nested(64) }],
      [{ name: 'read', annotations: { readOnlyHint: 'yes' } }],
      [{ name: 'read', annotations: { trusted: true } }],
      [{ name: 'read', execute: 'code' }],
      [{ name: 'read' }, { name: 'read' }],
      ['read'],
      { name: 'read' }
    ]) {
      expect(webMcpListingFromPage({ supported: true, descriptorJson: canonical(descriptors) })).toEqual(invalid)
    }
    // Not in the bridge's form: keys out of order, or padded.
    expect(webMcpListingFromPage({ supported: true, descriptorJson: JSON.stringify([{ title: 'Read', name: 'read' }]) })).toEqual(invalid)
    expect(webMcpListingFromPage({ supported: true, descriptorJson: ` ${canonical([tool])}` })).toEqual(invalid)
    expect(webMcpListingFromPage({ supported: true, descriptorJson: '[{"__proto__":{"name":"x"},"name":"read"}]' })).toEqual(invalid)
    expect(webMcpListingFromPage({ supported: true, descriptorJson: '[{"name":' })).toEqual(invalid)
    expect(webMcpListingFromPage({ supported: true, descriptorJson: ' '.repeat(2_000_000) + '[]' })).toEqual(invalid)
    // Deep enough to overflow the stack of a recursive reader, yet within the size limit.
    const deep = '[{"inputSchema":' + '{"items":'.repeat(15_000) + '1' + '}'.repeat(15_000) + ',"name":"read"}]'
    expect(webMcpListingFromPage({ supported: true, descriptorJson: deep })).toEqual(invalid)
  })

  it('keeps a schema\'s own data, a __proto__ key included, without touching any prototype', () => {
    const descriptorJson = '[{"inputSchema":{"__proto__":{"polluted":true},"type":"object"},"name":"read"}]'
    const listing = webMcpListingFromPage({ supported: true, descriptorJson }) as { tools: Array<{ inputSchema: object }> }
    expect(Object.hasOwn(listing.tools[0]!.inputSchema, '__proto__')).toBe(true)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('reports why there are no tools with a bounded reason and only the bridge\'s own list statuses', () => {
    expect(webMcpListingFromPage({ supported: true, status: 'WEBMCP_TIMEOUT', reason: 'tool-enumeration-timeout' })).toEqual({
      listed: false, supported: true, reason: 'tool-enumeration-timeout', status: 'WEBMCP_TIMEOUT'
    })
    expect(webMcpListingFromPage({ supported: true, status: 'WEBMCP_ERROR', error: 'e'.repeat(1_000) })).toEqual({
      listed: false, supported: true, reason: 'e'.repeat(500), status: 'WEBMCP_ERROR'
    })
    expect(webMcpListingFromPage({ supported: true, status: 'TOOL_RETURNED' })).toEqual(invalid)
    expect(webMcpListingFromPage({ supported: true })).toEqual(invalid)
    expect(webMcpListingFromPage({ supported: false, reason: 'document.modelContext is unavailable in this page' })).toEqual({
      listed: false, supported: false, reason: 'document.modelContext is unavailable in this page'
    })
  })

  it('keeps a call\'s status with the dispatch it means, and leaves out every other field the page adds', () => {
    expect(webMcpCallFromPage({
      supported: true, status: 'TOOL_RETURNED', dispatch: 'not-dispatched', effects: 'none',
      workspaceId: 'spoofed', tabId: 'spoofed', observation: { navigationChanged: false }, retrySafe: true,
      result: { value: { marker: 'ok' } }
    })).toEqual({ supported: true, status: 'TOOL_RETURNED', dispatch: 'dispatched', effects: 'possible', result: { value: { marker: 'ok' } } })
    expect(webMcpCallFromPage({ supported: true, status: 'STALE_DESCRIPTOR', dispatch: 'dispatched', effects: 'possible' })).toEqual({
      supported: true, status: 'STALE_DESCRIPTOR', dispatch: 'not-dispatched', effects: 'none'
    })
    expect(webMcpCallFromPage({ supported: true, status: 'TOOL_ERROR', error: 'x'.repeat(1_000), result: { value: 'not returned' } })).toEqual({
      supported: true, status: 'TOOL_ERROR', dispatch: 'dispatched', effects: 'possible', error: 'x'.repeat(500)
    })
    expect(webMcpCallFromPage({ supported: true, status: 'TOOL_ERROR', error: '' })).toEqual({
      supported: true, status: 'TOOL_ERROR', dispatch: 'dispatched', effects: 'possible', error: ''
    })
    expect(webMcpCallFromPage({ supported: false, reason: 'document.modelContext is unavailable in this page', status: 'TOOL_RETURNED' })).toEqual({
      supported: false, reason: 'document.modelContext is unavailable in this page'
    })
  })

  it('treats any other answer as one that may have called the tool', () => {
    for (const answer of [
      undefined, null, 'TOOL_RETURNED', [], {}, { supported: true }, { supported: 1, status: 'TOOL_RETURNED' },
      { supported: true, status: 'DONE' }, { supported: true, status: 'toString' }, { supported: true, status: '__proto__' }
    ]) {
      expect(webMcpCallFromPage(answer)).toEqual(unknownOutcome)
    }
  })

  it('bounds a returned result as the bridge does, and keeps the bridge\'s own preview of a longer one', () => {
    const long = 'x'.repeat(WEBMCP_LIMITS.maxResultChars * 3)
    const preview = JSON.stringify(Array.from({ length: 100 }, () => 'y'.repeat(1_000))).slice(0, WEBMCP_LIMITS.maxResultChars)
    expect(resultOf({ value: Array.from({ length: 100 }, () => 'y'.repeat(1_000)) })).toEqual({
      value: { preview, serialization: 'truncated-json' }, truncated: true
    })
    expect(resultOf({ value: { preview, serialization: 'truncated-json' }, truncated: true })).toEqual({
      value: { preview, serialization: 'truncated-json' }, truncated: true
    })
    // The bridge cuts strings, lists and objects before the length limit, and so does main.
    expect(resultOf({ value: long })).toEqual({ value: 'x'.repeat(20_000), truncated: true })
    expect(resultOf({ value: Array.from({ length: 150 }, (_, index) => index) })).toEqual({
      value: Array.from({ length: 100 }, (_, index) => index), truncated: true
    })
    expect(Object.keys((resultOf({ value: Object.fromEntries(Array.from({ length: 150 }, (_, index) => [`k${index}`, 0])) }) as { value: object }).value)).toHaveLength(100)
    expect(resultOf({ value: { list: [1, 2] }, truncated: true })).toEqual({ value: { list: [1, 2] }, truncated: true })
  })

  it('cuts what the page could make of a result: deep nesting, repeats, cycles and values JSON has no form for', () => {
    let deep: unknown = 0
    for (let level = 0; level < 1_000; level++) deep = [deep]
    let expected: unknown = '[truncated]'
    for (let level = 0; level < 8; level++) expected = [expected]
    expect(resultOf({ value: deep })).toEqual({ value: expected, truncated: true })
    const cyclic: Record<string, unknown> = { name: 'loop' }
    cyclic.self = cyclic
    expect(resultOf({ value: cyclic })).toEqual({ value: { name: 'loop', self: '[truncated]' }, truncated: true })
    expect(resultOf({ value: { missing: undefined } })).toEqual({ value: { missing: 'undefined' } })
  })

  it('keeps no object JSON.parse does not make, so a page cannot make main list a key for each byte or character', () => {
    const bytes = new Uint8Array(1_000_000)
    expect(resultOf({ value: { bytes, map: new Map([['a', 1]]), text: Object('long text') as object } })).toEqual({
      value: { bytes: '[truncated]', map: '[truncated]', text: '[truncated]' }, truncated: true
    })
    expect(resultOf({ value: bytes, truncated: true })).toEqual({ value: '[truncated]', truncated: true })
    expect(webMcpCallFromPage(bytes)).toEqual(unknownOutcome)
    expect(resultOf({ value: Object.assign(Object.create(null) as object, { kept: 1 }) })).toEqual({ value: { kept: 1 } })
  })

  it('keeps no big integer, which the bridge gives as its digits, so a page cannot make main write out a huge one', () => {
    expect(resultOf({ value: { big: 10n, huge: 1n << 100_000n } })).toEqual({ value: { big: '[truncated]', huge: '[truncated]' }, truncated: true })
  })
})

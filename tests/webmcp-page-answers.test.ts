import { describe, expect, it } from 'vitest'
import { webMcpCallFromPage, webMcpListingFromPage, webMcpStatusFromPage } from '../src/main/browser/webmcp/webmcp-page-answers.js'
import { WEBMCP_LIMITS } from '../src/main/browser/webmcp-bridge.js'

const tool = { name: 'read', title: 'Read', description: 'Reads a value.', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }

describe('what main takes from the WebMCP page bridge, which runs where the page can change it', () => {
  it('keeps whether the page supports WebMCP and a bounded reason, nothing else', () => {
    expect(webMcpStatusFromPage({ supported: true, reason: 'x'.repeat(10_000), tabId: 'spoofed' })).toEqual({ supported: true, reason: 'x'.repeat(500) })
    expect(webMcpStatusFromPage({ supported: 'yes', reason: { nested: true } })).toEqual({ supported: false })
    expect(webMcpStatusFromPage(undefined)).toEqual({ supported: false })
  })

  it('lists the tools parsed from the descriptor JSON it digests, not tools the page names beside it', () => {
    const descriptorJson = JSON.stringify([tool, { name: 'write' }])
    expect(webMcpListingFromPage({ supported: true, descriptorJson, descriptors: [{ name: 'other' }], workspaceId: 'spoofed' })).toEqual({
      listed: true, descriptorJson, tools: [tool, { name: 'write' }]
    })
  })

  it('refuses descriptor JSON the bridge would not give: past its limits, of another shape, or not JSON', () => {
    const refused = { listed: false, supported: true, reason: 'The page did not return a valid WebMCP descriptor', status: 'WEBMCP_ERROR' }
    const many = Array.from({ length: WEBMCP_LIMITS.maxTools + 1 }, (_, index) => ({ name: `tool-${index}` }))
    for (const descriptors of [
      many,
      [{ name: 'n'.repeat(WEBMCP_LIMITS.maxNameChars + 1) }],
      [{ name: '' }],
      [{ name: 'read', title: 't'.repeat(WEBMCP_LIMITS.maxTitleChars + 1) }],
      [{ name: 'read', description: 'd'.repeat(WEBMCP_LIMITS.maxDescriptionChars + 1) }],
      [{ name: 'read', inputSchema: { description: 's'.repeat(WEBMCP_LIMITS.maxSchemaChars) } }],
      [{ name: 'read', annotations: { readOnlyHint: 'yes' } }],
      [{ name: 'read', annotations: { trusted: true } }],
      [{ name: 'read', execute: 'code' }],
      [{ name: 'read' }, { name: 'read' }],
      ['read'],
      { name: 'read' }
    ]) {
      expect(webMcpListingFromPage({ supported: true, descriptorJson: JSON.stringify(descriptors) })).toEqual(refused)
    }
    expect(webMcpListingFromPage({ supported: true, descriptorJson: '[{"name":' })).toEqual(refused)
    expect(webMcpListingFromPage({ supported: true, descriptorJson: ' '.repeat(2_000_000) + '[]' })).toEqual(refused)
  })

  it('reports why there are no tools with a bounded reason and only the bridge\'s own list statuses', () => {
    expect(webMcpListingFromPage({ supported: true, status: 'WEBMCP_TIMEOUT', reason: 'tool-enumeration-timeout' })).toEqual({
      listed: false, supported: true, reason: 'tool-enumeration-timeout', status: 'WEBMCP_TIMEOUT'
    })
    expect(webMcpListingFromPage({ supported: true, status: 'WEBMCP_ERROR', error: 'e'.repeat(1_000) })).toEqual({
      listed: false, supported: true, reason: 'e'.repeat(500), status: 'WEBMCP_ERROR'
    })
    expect(webMcpListingFromPage({ supported: true, status: 'TOOL_RETURNED' })).toEqual({
      listed: false, supported: true, reason: 'The page did not return a valid WebMCP descriptor'
    })
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
    expect(webMcpCallFromPage({ supported: false, reason: 'document.modelContext is unavailable in this page', status: 'TOOL_RETURNED' })).toEqual({
      supported: false, reason: 'document.modelContext is unavailable in this page'
    })
  })

  it('treats an answer with no status of the bridge\'s as one that may have called the tool', () => {
    for (const answer of [{ supported: true }, { supported: true, status: 'DONE' }, { supported: true, status: 'toString' }]) {
      expect(webMcpCallFromPage(answer)).toEqual({
        supported: true, status: 'WEBMCP_ERROR', dispatch: 'possibly-dispatched', effects: 'possible', retrySafe: false,
        reason: 'The page returned no valid WebMCP outcome'
      })
    }
  })

  it('bounds a returned result as the bridge does, keeping the bridge\'s own preview of a longer one', () => {
    const long = 'x'.repeat(WEBMCP_LIMITS.maxResultChars * 3)
    const call = (result: unknown): unknown => (webMcpCallFromPage({ supported: true, status: 'TOOL_RETURNED', result }) as { result: unknown }).result
    const preview = JSON.stringify(long).slice(0, WEBMCP_LIMITS.maxResultChars)
    expect(call({ value: long })).toEqual({ value: { preview, serialization: 'truncated-json' }, truncated: true })
    expect(call({ value: { preview, serialization: 'truncated-json' }, truncated: true })).toEqual({
      value: { preview, serialization: 'truncated-json' }, truncated: true
    })
    expect(call({ value: { preview: preview + 'more', serialization: 'truncated-json' }, truncated: true })).toEqual({
      value: { preview: JSON.stringify({ preview: preview + 'more', serialization: 'truncated-json' }).slice(0, WEBMCP_LIMITS.maxResultChars), serialization: 'truncated-json' },
      truncated: true
    })
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(call({ value: cyclic })).toEqual({ value: null, truncated: true })
    expect(call({ value: { list: [1, 2] }, truncated: true })).toEqual({ value: { list: [1, 2] }, truncated: true })
    expect(call(undefined)).toEqual({ value: null })
  })
})

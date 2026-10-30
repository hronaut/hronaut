// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  webMcpCallScript,
  webMcpDescriptorDigest,
  webMcpListScript,
  webMcpStatusScript,
  type WebMcpPageListing
} from '../src/main/browser/webmcp-bridge.js'
import { webMcpCallFromPage, webMcpListingFromPage } from '../src/main/browser/webmcp/webmcp-page-answers.js'

interface TestTool extends Record<string, unknown> {
  name: string
  window: Window
  origin: string
  execute: (input: Record<string, unknown>) => unknown
}

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(document, 'modelContext')
})

function installModelContext(tools: TestTool[]): void {
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    value: {
      getTools: async () => tools,
      executeTool: async (tool: TestTool, input: Record<string, unknown> | string) => {
        const parsed = typeof input === 'string' ? JSON.parse(input) as Record<string, unknown> : input
        return JSON.stringify(await tool.execute(parsed))
      }
    }
  })
}

describe('WebMCP page bridge', () => {
  it('reports unsupported without injecting a page API', async () => {
    const result = await window.eval(webMcpStatusScript()) as WebMcpPageListing
    expect(result).toMatchObject({ supported: false })
    expect('modelContext' in document).toBe(false)
  })

  it('bounds top-level metadata, normalizes legacy schemas, and rejects descriptor drift before dispatch', async () => {
    let executions = 0
    const topLevel: TestTool = {
      name: 'increment',
      description: 'Increment a synthetic value.',
      inputSchema: JSON.stringify({ type: 'object', properties: { amount: { type: 'number' } } }),
      annotations: { readOnlyHint: false },
      window,
      origin: location.origin,
      execute: ({ amount }) => {
        executions += 1
        return { value: amount }
      }
    }
    const iframe = {
      ...topLevel,
      name: 'shadow',
      window: {} as Window,
      execute: () => ({ shadow: true })
    }
    installModelContext([iframe, topLevel])
    const listed = await window.eval(webMcpListScript()) as WebMcpPageListing
    expect(JSON.parse(listed.descriptorJson!)).toEqual([
      expect.objectContaining({
        name: 'increment',
        inputSchema: { type: 'object', properties: { amount: { type: 'number' } } }
      })
    ])
    expect(listed.descriptorJson).toEqual(expect.any(String))
    expect(webMcpDescriptorDigest(listed.descriptorJson!)).toMatch(/^[a-f0-9]{64}$/u)

    topLevel.description = 'Changed after listing.'
    const stale = await window.eval(webMcpCallScript({
      descriptorJson: listed.descriptorJson!,
      toolName: 'increment',
      arguments: { amount: 2 }
    })) as Record<string, unknown>
    expect(stale).toMatchObject({ status: 'STALE_DESCRIPTOR', dispatch: 'not-dispatched', effects: 'none' })
    expect(executions).toBe(0)
  })

  it('returns a bounded structured result for the exact descriptor', async () => {
    const tool: TestTool = {
      name: 'read',
      inputSchema: JSON.stringify({ type: 'object' }),
      window,
      origin: location.origin,
      execute: ({ marker }) => ({ marker })
    }
    installModelContext([tool])
    const listed = await window.eval(webMcpListScript()) as WebMcpPageListing
    const called = await window.eval(webMcpCallScript({
      descriptorJson: listed.descriptorJson!,
      toolName: 'read',
      arguments: { marker: 'ok' }
    })) as Record<string, unknown>
    expect(called).toMatchObject({
      status: 'TOOL_RETURNED', dispatch: 'dispatched', effects: 'possible',
      result: { value: { marker: 'ok' } }
    })
    expect(webMcpCallFromPage(called)).toEqual({
      supported: true, status: 'TOOL_RETURNED', dispatch: 'dispatched', effects: 'possible', result: { value: { marker: 'ok' } }
    })
  })

  it('gives main a listing and a long result that pass its own checks unchanged', async () => {
    const tool: TestTool = {
      name: 'read',
      title: 'Quotes " and \\ slashes\u0001',
      inputSchema: JSON.stringify({ type: 'object' }),
      window,
      origin: location.origin,
      execute: () => ({ parts: Array.from({ length: 10 }, () => 'y'.repeat(19_000)) })
    }
    installModelContext([tool])
    const listed = await window.eval(webMcpListScript()) as WebMcpPageListing
    expect(webMcpListingFromPage(listed)).toEqual({
      listed: true,
      descriptorJson: listed.descriptorJson,
      tools: [{ name: 'read', title: tool.title, inputSchema: { type: 'object' } }]
    })
    const called = await window.eval(webMcpCallScript({
      descriptorJson: listed.descriptorJson!,
      toolName: 'read',
      arguments: {}
    })) as Record<string, unknown>
    expect(called.result).toMatchObject({ value: { serialization: 'truncated-json' }, truncated: true })
    expect(webMcpCallFromPage(called)).toEqual({
      supported: true, status: 'TOOL_RETURNED', dispatch: 'dispatched', effects: 'possible', result: called.result
    })
  })

  it('classifies a synchronous callback throw as a possibly effectful dispatch', async () => {
    let effects = 0
    const tool: TestTool = {
      name: 'throw-after-effect',
      window,
      origin: location.origin,
      execute: () => undefined
    }
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        getTools: async () => [tool],
        executeTool: () => {
          effects += 1
          throw new Error('synthetic synchronous failure')
        }
      }
    })
    const listed = await window.eval(webMcpListScript()) as WebMcpPageListing
    const called = await window.eval(webMcpCallScript({
      descriptorJson: listed.descriptorJson!,
      toolName: tool.name,
      arguments: {}
    })) as Record<string, unknown>

    expect(effects).toBe(1)
    expect(called).toMatchObject({
      status: 'TOOL_ERROR', dispatch: 'dispatched', effects: 'possible',
      error: 'synthetic synchronous failure'
    })
  })

  it('reports a tool whose result or error cannot be read as one that ran', async () => {
    let calls = 0
    const tool: TestTool = { name: 'odd', window, origin: location.origin, execute: () => undefined }
    const answers = [
      () => ({ get value(): never { throw new Error('unreadable result') } }),
      () => { throw Object.create(null) as unknown }
    ]
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        getTools: async () => [tool],
        executeTool: () => answers[calls++]!()
      }
    })
    const listed = await window.eval(webMcpListScript()) as WebMcpPageListing
    const call = async (): Promise<Record<string, unknown>> => await window.eval(webMcpCallScript({
      descriptorJson: listed.descriptorJson!,
      toolName: 'odd',
      arguments: {}
    })) as Record<string, unknown>

    expect(await call()).toEqual({
      supported: true, status: 'OUTCOME_UNKNOWN', dispatch: 'dispatched', effects: 'possible', reason: 'result-unreadable',
      error: 'unreadable result'
    })
    expect(await call()).toEqual({
      supported: true, status: 'TOOL_ERROR', dispatch: 'dispatched', effects: 'possible',
      error: 'The page threw a value that cannot be read'
    })
    expect(calls).toBe(2)
  })

  it('gives a value JSON has no form for as its text, cut as long strings are, and main keeps that text', async () => {
    const huge = 10n ** 30_000n
    const tool: TestTool = { name: 'odd', window, origin: location.origin, execute: () => undefined }
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        getTools: async () => [tool],
        executeTool: async () => ({ big: 10n, huge, label: Symbol('x'.repeat(30_000)), missing: undefined })
      }
    })
    const listed = await window.eval(webMcpListScript()) as WebMcpPageListing
    const called = await window.eval(webMcpCallScript({
      descriptorJson: listed.descriptorJson!,
      toolName: 'odd',
      arguments: {}
    })) as Record<string, unknown>
    const value = { big: '10', huge: huge.toString().slice(0, 20_000), label: `Symbol(${'x'.repeat(30_000)})`.slice(0, 20_000), missing: 'undefined' }
    expect(called.result).toEqual({ value, truncated: true })
    expect(webMcpCallFromPage(called)).toMatchObject({ status: 'TOOL_RETURNED', result: { value, truncated: true } })
  })

  it('refuses a tool whose input schema is nested deeper than main reads', async () => {
    let schema: unknown = { type: 'string' }
    for (let level = 0; level < 64; level++) schema = { items: schema }
    const tool: TestTool = { name: 'deep', inputSchema: schema, window, origin: location.origin, execute: () => undefined }
    installModelContext([tool])
    const listed = await window.eval(webMcpListScript()) as WebMcpPageListing
    expect(listed).toMatchObject({ supported: true, status: 'WEBMCP_ERROR', error: 'WebMCP tool deep has an input schema nested more than 64 levels deep' })
    tool.inputSchema = (schema as { items: unknown }).items
    const shallower = await window.eval(webMcpListScript()) as WebMcpPageListing
    expect(webMcpListingFromPage(shallower)).toMatchObject({ listed: true })
  })

  it('bounds page tool enumeration with the same operation deadline', async () => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        getTools: () => new Promise<never>(() => undefined),
        executeTool: async () => undefined
      }
    })
    const pending = window.eval(webMcpListScript()) as Promise<Record<string, unknown>>
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(pending).resolves.toMatchObject({
      status: 'WEBMCP_TIMEOUT', dispatch: 'not-dispatched', effects: 'none',
      reason: 'tool-enumeration-timeout'
    })
  })
})

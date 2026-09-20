// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  webMcpCallScript,
  webMcpDescriptorDigest,
  webMcpListScript,
  webMcpStatusScript,
  type WebMcpPageListing
} from '../src/main/browser/webmcp-bridge.js'

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
    expect(listed.descriptors).toEqual([
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

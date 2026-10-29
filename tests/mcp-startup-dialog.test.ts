import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMcpRuntime } from '../src/main/mcp-runtime/mcp-runtime.js'
import { translate } from '../src/shared/i18n.js'
import type { TrustedDialogOptions } from '../src/main/trusted-dialogs/trusted-dialogs.js'

afterEach(() => { vi.restoreAllMocks() })

type Failure = { code: 'port-in-use' | 'port-denied' | 'other', port: number, suggestedPort?: number }

/** A runtime whose listener cannot start, with `failure` as port recovery records it and `answers` for each question. */
function failingRuntime(failure: Failure | undefined, answers: number[], move: { outcome: string, port: number } = { outcome: 'moved', port: 0 }) {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const server = {
    start: vi.fn(async () => { throw new Error('listen EADDRINUSE: address already in use 127.0.0.1:14560') }),
    stop: vi.fn(async () => undefined),
    setPaused: vi.fn()
  }
  const recovery = {
    failure: undefined as Failure | undefined,
    signal: new AbortController().signal,
    record: vi.fn(async () => { recovery.failure = failure }),
    move: vi.fn(async () => move),
    clear: vi.fn()
  }
  const showDialog = vi.fn(async (_options: Omit<TrustedDialogOptions, 'window'>) => ({ response: answers.shift() ?? 0 }))
  const runtime = createMcpRuntime({
    state: { host: '127.0.0.1', server: null, port: 14560, url: 'http://127.0.0.1:14560/mcp', status: 'starting', startupError: undefined, tokenConfiguration: null },
    createServer: () => server as never,
    mcpPauseState: { paused: false, temporarilyPaused: false },
    mcpPortRecovery: recovery as never,
    settings: () => ({}) as never,
    persistedSettings: () => ({}) as never,
    updateSettings: vi.fn(),
    publishSettings: vi.fn(),
    publishMcpControlState: vi.fn() as never,
    refreshHomeAfterCommittedChange: vi.fn(),
    assertWorkspaceInitialized: vi.fn(),
    tabs: () => null,
    text: (key, parameters) => translate('en-US', key, parameters),
    showDialog
  })
  return { runtime, showDialog, recovery }
}

describe('the dialog for an MCP listener that could not start', () => {
  it('offers the free port in Hronaut’s own dialog, and moves there on its button', async () => {
    const { runtime, showDialog, recovery } = failingRuntime({ code: 'port-in-use', port: 14560, suggestedPort: 14561 }, [1])
    await runtime.startMcpServer()
    expect(showDialog).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      type: 'error',
      title: 'MCP server failed to start',
      message: 'Another app is using port 14560',
      buttons: ['Not now', 'Use port 14561'],
      defaultId: 1,
      cancelId: 0,
      primaryId: 1,
      signal: recovery.signal,
      variant: { kind: 'message', topic: 'agent-connection' }
    }))
    expect(recovery.move).toHaveBeenCalledExactlyOnceWith(14561)
  })

  it('says what failed with an OK button when no port is offered, and after a move that fails', async () => {
    const plain = failingRuntime({ code: 'other', port: 14560 }, [0])
    await plain.runtime.startMcpServer()
    expect(plain.showDialog).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      message: 'Could not listen on 127.0.0.1:14560',
      detail: 'listen EADDRINUSE: address already in use 127.0.0.1:14560',
      buttons: ['OK'],
      variant: { kind: 'message', topic: 'agent-connection' }
    }))

    const moved = failingRuntime({ code: 'port-in-use', port: 14560, suggestedPort: 14561 }, [1, 0], { outcome: 'failed', port: 14561 })
    await moved.runtime.startMcpServer()
    expect(moved.showDialog).toHaveBeenCalledTimes(2)
    expect(moved.showDialog.mock.calls[1]![0]).toEqual({
      type: 'error',
      title: 'MCP server failed to start',
      message: 'Could not listen on 127.0.0.1:14561',
      buttons: ['OK'],
      variant: { kind: 'message', topic: 'agent-connection' }
    })
  })
})

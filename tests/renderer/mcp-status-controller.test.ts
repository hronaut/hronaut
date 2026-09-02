import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMcpStatusController } from '../../src/renderer/src/composables/useMcpStatusController.js'
import type { HronautMcpApi, McpControlState } from '../../src/shared/types.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function control(overrides: Partial<McpControlState> = {}): McpControlState {
  return { status: 'ready', paused: false, ...overrides }
}

function createController(getState: () => Promise<McpControlState> = async () => control()) {
  let listener: ((state: McpControlState) => void) | undefined
  const setPaused = vi.fn(async (paused: boolean) => control({ status: paused ? 'paused' : 'ready', paused }))
  const unsubscribe = vi.fn(() => { listener = undefined })
  const api: HronautMcpApi = {
    getState: vi.fn(getState),
    setPaused,
    onChanged: vi.fn((next: (state: McpControlState) => void) => {
      listener = next
      return unsubscribe
    })
  }
  const copyText = vi.fn(async () => true)
  const onPauseError = vi.fn()
  const endpoint = ref('http://127.0.0.1:47812/mcp')
  const controller = useMcpStatusController({ api, endpoint, copyText, onPauseError })
  return {
    controller,
    copyText,
    endpoint,
    emit: (state: McpControlState) => listener?.(state),
    onPauseError,
    setPaused,
    unsubscribe
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('MCP status controller', () => {
  it('does not overwrite a live ready event with an older starting snapshot', async () => {
    const initial = deferred<McpControlState>()
    const { controller, emit } = createController(() => initial.promise)

    const initializing = controller.initialize()
    emit(control())
    initial.resolve(control({ status: 'starting' }))
    await initializing

    expect(controller.state.value).toEqual(control())
    controller.dispose()
  })

  it('preserves an event delivered while the listener is being attached', async () => {
    const api: HronautMcpApi = {
      getState: vi.fn(async () => control({ status: 'starting' })),
      setPaused: vi.fn(async (paused: boolean) => control({ status: paused ? 'paused' : 'ready', paused })),
      onChanged: vi.fn((next: (state: McpControlState) => void) => {
        next(control())
        return () => undefined
      })
    }
    const controller = useMcpStatusController({
      api,
      endpoint: ref('http://127.0.0.1:47812/mcp'),
      copyText: vi.fn(async () => true),
      onPauseError: vi.fn()
    })

    await controller.initialize()

    expect(controller.state.value).toEqual(control())
    controller.dispose()
  })

  it('keeps a newer pause event when an earlier response resolves later', async () => {
    const pausing = deferred<McpControlState>()
    const { controller, emit, setPaused } = createController()
    await controller.initialize()
    setPaused.mockImplementationOnce(() => pausing.promise)

    const operation = controller.togglePaused()
    emit(control({ status: 'paused', paused: true }))
    pausing.resolve(control())
    await expect(operation).resolves.toBe(true)

    expect(controller.state.value).toEqual(control({ status: 'paused', paused: true }))
    controller.dispose()
  })

  it('blocks duplicate pause toggles until the first response settles', async () => {
    const pausing = deferred<McpControlState>()
    const { controller, setPaused } = createController()
    await controller.initialize()
    setPaused.mockImplementationOnce(() => pausing.promise)

    const operation = controller.togglePaused()
    await expect(controller.togglePaused()).resolves.toBe(false)

    expect(setPaused).toHaveBeenCalledOnce()
    expect(setPaused).toHaveBeenCalledWith(true)
    pausing.resolve(control({ status: 'paused', paused: true }))
    await operation
    controller.dispose()
  })

  it('restarts copied feedback when the endpoint is copied again', async () => {
    vi.useFakeTimers()
    const { controller, copyText } = createController()

    await expect(controller.copyEndpoint()).resolves.toBe(true)
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(controller.copyEndpoint()).resolves.toBe(true)
    await vi.advanceTimersByTimeAsync(600)

    expect(copyText).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:47812/mcp')
    expect(controller.copied.value).toBe(true)
    await vi.advanceTimersByTimeAsync(900)
    expect(controller.copied.value).toBe(false)
    controller.dispose()
  })

  it('does not show copied feedback when the clipboard write fails', async () => {
    const { controller, copyText } = createController()
    copyText.mockResolvedValueOnce(false)

    await expect(controller.copyEndpoint()).resolves.toBe(false)

    expect(controller.copied.value).toBe(false)
    controller.dispose()
  })

  it('does not show copied feedback for an endpoint that changed during clipboard write', async () => {
    const copying = deferred<boolean>()
    const { controller, copyText, endpoint } = createController()
    copyText.mockImplementationOnce(() => copying.promise)

    const operation = controller.copyEndpoint()
    endpoint.value = 'http://127.0.0.1:49000/mcp'
    copying.resolve(true)

    await expect(operation).resolves.toBe(false)
    expect(controller.copied.value).toBe(false)
    controller.dispose()
  })

  it('reports the MCP source error when listener cleanup also fails', async () => {
    const initial = deferred<McpControlState>()
    const sourceError = new Error('MCP status unavailable')
    const getState = vi.fn()
      .mockReturnValueOnce(initial.promise)
      .mockResolvedValueOnce(control())
    const { controller, emit, onPauseError, unsubscribe } = createController(getState)
    unsubscribe.mockImplementationOnce(() => {
      throw new Error('MCP listener already closed')
    })

    const initializing = controller.initialize()
    initial.reject(sourceError)
    await expect(initializing).rejects.toThrow()

    expect(onPauseError).toHaveBeenCalledWith(sourceError)
    expect(unsubscribe).toHaveBeenCalledOnce()

    emit(control({ status: 'paused', paused: true }))
    expect(controller.state.value).toEqual({ status: 'starting', paused: false })

    await expect(controller.initialize()).resolves.toBeUndefined()
    expect(getState).toHaveBeenCalledTimes(2)
    expect(controller.state.value).toEqual(control())
    controller.dispose()
  })

  it('clears pending MCP feedback and pause state when listener disposal fails', async () => {
    vi.useFakeTimers()
    const pausing = deferred<McpControlState>()
    const { controller, setPaused, unsubscribe } = createController()
    await controller.initialize()
    await controller.copyEndpoint()
    setPaused.mockReturnValueOnce(pausing.promise)
    const pauseOperation = controller.togglePaused()
    expect(controller.copied.value).toBe(true)
    expect(controller.pauseBusy.value).toBe(true)
    unsubscribe.mockImplementationOnce(() => {
      throw new Error('MCP listener already closed')
    })

    expect(() => controller.dispose()).toThrow('MCP listener already closed')

    expect(controller.copied.value).toBe(false)
    expect(controller.pauseBusy.value).toBe(false)
    pausing.resolve(control({ status: 'paused', paused: true }))
    await expect(pauseOperation).resolves.toBe(false)
  })
})

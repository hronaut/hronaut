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

  it.each(['success', 'failure'].flatMap((older) => (
    ['success', 'failure'].map((newer) => ({ older, newer }))
  )))('keeps the latest refresh authoritative: $older then $newer', async ({ older, newer }) => {
    const previous = deferred<McpControlState>()
    const latest = deferred<McpControlState>()
    const getState = vi.fn()
      .mockResolvedValueOnce(control())
      .mockReturnValueOnce(previous.promise)
      .mockReturnValueOnce(latest.promise)
    const { controller } = createController(getState)
    await controller.initialize()
    const first = controller.refresh()
    const second = controller.refresh()

    if (older === 'success') previous.resolve(control({ activeCommands: 1 }))
    else previous.reject(new Error('old refresh failed'))
    await first
    expect(controller.state.value).toEqual(control())
    expect(controller.refreshFailed.value).toBe(false)

    if (newer === 'success') latest.resolve(control({ activeCommands: 2 }))
    else latest.reject(new Error('latest refresh failed'))
    await second
    expect(controller.refreshFailed.value).toBe(newer === 'failure')
    expect(controller.state.value).toEqual(newer === 'success'
      ? control({ activeCommands: 2 })
      : control({ readiness: undefined }))
    controller.dispose()
  })

  it.each(['success', 'failure'] as const)('preserves live events over a refresh %s', async (outcome) => {
    const pending = deferred<McpControlState>()
    const getState = vi.fn().mockResolvedValueOnce(control()).mockReturnValueOnce(pending.promise)
    const { controller, emit } = createController(getState)
    await controller.initialize()
    const refreshing = controller.refresh()
    const live = control({ status: 'paused', paused: true })
    emit(live)
    if (outcome === 'success') pending.resolve(control())
    else pending.reject(new Error('refresh failed'))
    await refreshing
    expect(controller.state.value).toEqual(live)
    expect(controller.refreshFailed.value).toBe(false)
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

  it.each([true, false])('clears old endpoint feedback while another write is pending (success: %s)', async succeeded => {
    vi.useFakeTimers()
    const pending = deferred<boolean>()
    const { controller, copyText, setPaused } = createController()
    await controller.copyEndpoint()
    await vi.advanceTimersByTimeAsync(1_000)
    copyText.mockImplementationOnce(() => pending.promise)
    const operation = controller.copyEndpoint()
    expect(controller.copied.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    pending.resolve(succeeded)
    await expect(operation).resolves.toBe(succeeded)
    expect(controller.copied.value).toBe(succeeded)
    await vi.advanceTimersByTimeAsync(600)
    expect(controller.copied.value).toBe(succeeded)
    await vi.advanceTimersByTimeAsync(900)
    expect(controller.copied.value).toBe(false)
    expect(copyText).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:47812/mcp')
    expect(setPaused).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('does not let an older endpoint copy completion replace newer feedback', async () => {
    const pending = deferred<boolean>()
    const { controller, copyText } = createController()
    copyText.mockImplementationOnce(() => pending.promise)
    const first = controller.copyEndpoint()
    await expect(controller.copyEndpoint()).resolves.toBe(true)
    pending.resolve(false)
    await expect(first).resolves.toBe(false)
    expect(controller.copied.value).toBe(true)
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

  it('clears copied feedback immediately when the endpoint changes', async () => {
    vi.useFakeTimers()
    const { controller, endpoint } = createController()
    await controller.copyEndpoint()
    expect(controller.copied.value).toBe(true)

    endpoint.value = 'http://127.0.0.1:49000/mcp'

    expect(controller.copied.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    await controller.copyEndpoint()
    expect(controller.copied.value).toBe(true)
    controller.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores a pending copy when the endpoint changes away and back', async () => {
    const copying = deferred<boolean>()
    const { controller, copyText, endpoint } = createController()
    copyText.mockReturnValueOnce(copying.promise)
    const originalEndpoint = endpoint.value
    const operation = controller.copyEndpoint()

    endpoint.value = 'http://127.0.0.1:49000/mcp'
    endpoint.value = originalEndpoint
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

  it('keeps a user pause authoritative while failed startup initialization retries', async () => {
    const initial = deferred<McpControlState>()
    const retrySnapshot = deferred<McpControlState>()
    const pausing = deferred<McpControlState>()
    const getState = vi.fn()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(retrySnapshot.promise)
    const { controller, emit, setPaused } = createController(getState)

    const initializing = controller.initialize()
    emit(control())
    initial.reject(new Error('MCP status unavailable'))
    await expect(initializing).rejects.toThrow('MCP status unavailable')
    expect(controller.canTogglePaused.value).toBe(true)

    setPaused.mockReturnValueOnce(pausing.promise)
    const pauseOperation = controller.togglePaused()
    const retrying = controller.initialize()
    pausing.resolve(control({ status: 'paused', paused: true }))

    await expect(pauseOperation).resolves.toBe(true)
    expect(controller.state.value).toEqual(control({ status: 'paused', paused: true }))
    expect(controller.pauseBusy.value).toBe(false)
    expect(controller.canTogglePaused.value).toBe(true)

    retrySnapshot.resolve(control({ status: 'paused', paused: true }))
    await expect(retrying).resolves.toBeUndefined()
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

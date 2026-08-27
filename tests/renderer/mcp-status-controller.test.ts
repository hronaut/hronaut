import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMcpStatusController } from '../../src/renderer/src/composables/useMcpStatusController.js'
import type { HronautMcpApi, McpControlState } from '../../src/shared/types.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => { resolve = next })
  return { promise, resolve }
}

function control(overrides: Partial<McpControlState> = {}): McpControlState {
  return { status: 'ready', paused: false, ...overrides }
}

function createController(getState: () => Promise<McpControlState> = async () => control()) {
  let listener: ((state: McpControlState) => void) | undefined
  const setPaused = vi.fn(async (paused: boolean) => control({ status: paused ? 'paused' : 'ready', paused }))
  const api: HronautMcpApi = {
    getState: vi.fn(getState),
    setPaused,
    onChanged: vi.fn((next: (state: McpControlState) => void) => {
      listener = next
      return () => { listener = undefined }
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
    setPaused
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
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTaskManagerController } from '../../src/renderer/src/features/task-manager/useTaskManagerController.js'
import type { TaskManagerProcess } from '../../src/shared/types.js'

function process(pid: number, overrides: Partial<TaskManagerProcess> = {}): TaskManagerProcess {
  return { pid, kind: 'page', tabIds: [], subframes: [], devToolsTabIds: [], memoryBytes: 1024, cpuPercent: 0, canEnd: false, ...overrides }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((next, fail) => { resolve = next; reject = fail })
  return { promise, resolve, reject }
}

function harness() {
  const api = { list: vi.fn(async () => [process(1)]), endProcess: vi.fn<(pid: number) => Promise<void>>(async () => undefined) }
  const beforeOpen = vi.fn()
  const controller = useTaskManagerController({ api, beforeOpen, formatError: (error) => `failed: ${(error as Error).message}`, refreshMs: 1000 })
  return { api, beforeOpen, controller }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('the Task manager controller', () => {
  it('reads the processes on opening and every second while open, and stops once closed', async () => {
    const { api, beforeOpen, controller } = harness()
    controller.openDialog()
    expect(beforeOpen).toHaveBeenCalledOnce()
    expect(controller.open.value).toBe(true)
    expect(controller.state.value).toBe('loading')
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.state.value).toBe('ready')
    expect(controller.processes.value.map((entry) => entry.pid)).toEqual([1])
    expect(api.list).toHaveBeenCalledTimes(1)

    api.list.mockResolvedValue([process(1), process(2)])
    await vi.advanceTimersByTimeAsync(1000)
    expect(api.list).toHaveBeenCalledTimes(2)
    expect(controller.processes.value.map((entry) => entry.pid)).toEqual([1, 2])
    await vi.advanceTimersByTimeAsync(1000)
    expect(api.list).toHaveBeenCalledTimes(3)

    controller.close()
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.list).toHaveBeenCalledTimes(3)
    controller.dispose()
  })

  it('toggles open and closed, as Shift+Esc does', async () => {
    const { controller } = harness()
    controller.toggle()
    expect(controller.open.value).toBe(true)
    controller.toggle()
    expect(controller.open.value).toBe(false)
    controller.dispose()
  })

  it('keeps a reading that finishes after the dialog closed or reopened from changing it', async () => {
    const { api, controller } = harness()
    const late = deferred<TaskManagerProcess[]>()
    api.list.mockReturnValueOnce(late.promise)
    controller.openDialog()
    controller.close()
    api.list.mockResolvedValueOnce([process(7)])
    controller.openDialog()
    await vi.advanceTimersByTimeAsync(0)
    late.resolve([process(99)])
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.processes.value.map((entry) => entry.pid)).toEqual([7])
    controller.dispose()
  })

  it('shows an error when nothing could be read, and keeps the list it has when a later reading fails', async () => {
    const { api, controller } = harness()
    api.list.mockRejectedValueOnce(new Error('offline'))
    controller.openDialog()
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.state.value).toBe('error')
    expect(controller.error.value).toBe('failed: offline')

    api.list.mockResolvedValueOnce([process(3)])
    await vi.advanceTimersByTimeAsync(1000)
    expect(controller.state.value).toBe('ready')
    expect(controller.error.value).toBe('')

    api.list.mockRejectedValueOnce(new Error('again'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(controller.state.value).toBe('ready')
    expect(controller.processes.value.map((entry) => entry.pid)).toEqual([3])
    expect(controller.error.value).toBe('failed: again')
    controller.dispose()
  })

  it('ends a process one at a time, then reads the list again at once', async () => {
    const { api, controller } = harness()
    controller.openDialog()
    await vi.advanceTimersByTimeAsync(0)
    const ending = deferred<void>()
    api.endProcess.mockReturnValueOnce(ending.promise)
    const first = controller.endProcess(5)
    expect(controller.ending.value).toBe(5)
    // A second End process while the first runs does nothing.
    await controller.endProcess(6)
    expect(api.endProcess.mock.calls).toEqual([[5]])
    api.list.mockResolvedValueOnce([process(1)])
    const readings = api.list.mock.calls.length
    ending.resolve()
    await first
    expect(api.list.mock.calls.length).toBe(readings + 1)
    expect(controller.ending.value).toBeNull()
    controller.dispose()
  })

  it('keeps a slower reading from replacing a newer one, such as the one End process asks for', async () => {
    const { api, controller } = harness()
    api.list.mockResolvedValueOnce([process(1), process(5)])
    controller.openDialog()
    await vi.advanceTimersByTimeAsync(0)
    const slow = deferred<TaskManagerProcess[]>()
    api.list.mockReturnValueOnce(slow.promise)
    // The timer's reading starts and waits; End process then reads the list without the ended process.
    await vi.advanceTimersByTimeAsync(1000)
    api.list.mockResolvedValueOnce([process(1)])
    await controller.endProcess(5)
    expect(controller.processes.value.map((entry) => entry.pid)).toEqual([1])
    slow.resolve([process(1), process(5)])
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.processes.value.map((entry) => entry.pid)).toEqual([1])
    controller.dispose()
  })

  it('reports a refused End process and lets the person try another', async () => {
    const { api, controller } = harness()
    controller.openDialog()
    await vi.advanceTimersByTimeAsync(0)
    api.endProcess.mockRejectedValueOnce(new Error('This process cannot be ended'))
    await controller.endProcess(5)
    expect(controller.error.value).toBe('failed: This process cannot be ended')
    expect(controller.ending.value).toBeNull()
    await controller.endProcess(6)
    expect(api.endProcess.mock.calls).toEqual([[5], [6]])
    controller.dispose()
  })

  it('reads nothing after it is disposed', async () => {
    const { api, controller } = harness()
    controller.openDialog()
    await vi.advanceTimersByTimeAsync(0)
    controller.dispose()
    controller.openDialog()
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.list).toHaveBeenCalledOnce()
    expect(controller.open.value).toBe(false)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  friendlyUiError,
  useAppToastController
} from '../../src/renderer/src/composables/useAppToastController.js'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('app toast controller', () => {
  it('normalizes Electron IPC errors without hiding a useful message', () => {
    expect(friendlyUiError(
      new Error("Error invoking remote method 'browser:reload': Error: Renderer disappeared"),
      'Action failed'
    )).toBe('Renderer disappeared')
    expect(friendlyUiError({}, 'Action failed')).toBe('Action failed')
  })

  it('bounds authored content and replaces an existing notification', () => {
    vi.useFakeTimers()
    const controller = useAppToastController()

    controller.show('info', `  ${'T'.repeat(140)}  `, `  ${'M'.repeat(1_100)}  `)
    const firstId = controller.toasts.value[0].id
    controller.show('success', 'Saved', 'Ready')

    expect(controller.toasts.value).toEqual([{
      id: firstId,
      tone: 'success',
      title: 'Saved',
      message: 'Ready'
    }])
    controller.dispose()
  })

  it('keeps errors visible longer and cancels stale replacement timers', async () => {
    vi.useFakeTimers()
    const controller = useAppToastController()

    controller.show('success', 'Saved', 'First')
    await vi.advanceTimersByTimeAsync(3_000)
    controller.show('error', 'Failed', 'Second')
    await vi.advanceTimersByTimeAsync(700)
    expect(controller.toasts.value[0]?.title).toBe('Failed')

    await vi.advanceTimersByTimeAsync(7_299)
    expect(controller.toasts.value[0]?.title).toBe('Failed')
    await vi.advanceTimersByTimeAsync(1)
    expect(controller.toasts.value).toEqual([])
    controller.dispose()
  })

  it('does not let an already-queued expiry dismiss its replacement', () => {
    const callbacks: Array<() => void> = []
    vi.spyOn(window, 'setTimeout').mockImplementation(((callback: TimerHandler) => {
      callbacks.push(callback as () => void)
      return callbacks.length
    }) as typeof window.setTimeout)
    vi.spyOn(window, 'clearTimeout').mockImplementation(() => undefined)
    const controller = useAppToastController()

    controller.show('success', 'Saved', 'First')
    const staleExpiry = callbacks[0]
    controller.show('error', 'Save link failed', 'The tab is no longer available')
    staleExpiry()

    expect(controller.toasts.value[0]).toMatchObject({
      tone: 'error',
      title: 'Save link failed'
    })
    controller.dispose()
  })

  it('dismisses explicitly and clears all pending work on disposal', async () => {
    vi.useFakeTimers()
    const controller = useAppToastController()

    controller.show('info', 'Notice', 'Message')
    controller.dismiss(controller.toasts.value[0].id)
    expect(controller.toasts.value).toEqual([])

    controller.show('error', 'Failed', 'Message')
    controller.dispose()
    await vi.runAllTimersAsync()
    expect(controller.toasts.value).toEqual([])
  })

  it('ignores notifications that arrive after disposal', async () => {
    vi.useFakeTimers()
    const controller = useAppToastController()

    controller.show('info', 'Notice', 'Before teardown')
    controller.dispose()
    controller.show('error', 'Late failure', 'After teardown')

    expect(controller.toasts.value).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    await vi.runAllTimersAsync()
    expect(controller.toasts.value).toEqual([])
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  friendlyUiError,
  useAppToastController
} from '../../src/renderer/src/composables/useAppToastController.js'

afterEach(() => {
  vi.useRealTimers()
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
      id: firstId + 1,
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

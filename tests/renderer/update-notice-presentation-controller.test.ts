import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUpdateNoticePresentationController } from '../../src/renderer/src/composables/useUpdateNoticePresentationController.js'
import type { AppUpdateState } from '../../src/shared/types.js'

function createController(status: AppUpdateState['status'] = 'idle') {
  const open = ref(false)
  const settingsOpen = ref(false)
  const state = ref<AppUpdateState>({ status, currentVersion: '1.5.2' })
  const controller = useUpdateNoticePresentationController({
    open,
    settingsOpen,
    state,
    dismissAfterMs: 100
  })
  return { controller, open, settingsOpen, state }
}

describe('update notice presentation controller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows non-idle update feedback outside Settings', () => {
    const harness = createController('checking')
    harness.open.value = true
    expect(harness.controller.showStatusPill.value).toBe(true)

    harness.settingsOpen.value = true
    expect(harness.controller.showStatusPill.value).toBe(false)
    harness.settingsOpen.value = false
    harness.state.value = { status: 'idle', currentVersion: '1.5.2' }
    expect(harness.controller.showStatusPill.value).toBe(false)
    harness.controller.dispose()
  })

  it('auto-dismisses an up-to-date result after the presentation window', () => {
    const harness = createController('up-to-date')
    harness.open.value = true

    vi.advanceTimersByTime(99)
    expect(harness.open.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(harness.open.value).toBe(false)
    harness.controller.dispose()
  })

  it('cancels dismissal when a persistent update status arrives', () => {
    const harness = createController('up-to-date')
    harness.open.value = true
    vi.advanceTimersByTime(50)

    harness.state.value = { status: 'available', currentVersion: '1.5.2', availableVersion: '1.6.0' }
    vi.advanceTimersByTime(100)

    expect(harness.open.value).toBe(true)
    expect(harness.controller.showStatusPill.value).toBe(true)
    harness.controller.dispose()
  })

  it('starts a fresh dismissal window when the notice is reopened', () => {
    const harness = createController('up-to-date')
    harness.open.value = true
    vi.advanceTimersByTime(50)
    harness.open.value = false
    harness.open.value = true

    vi.advanceTimersByTime(50)
    expect(harness.open.value).toBe(true)
    vi.advanceTimersByTime(50)
    expect(harness.open.value).toBe(false)
    harness.controller.dispose()
  })

  it('does not mutate notice state from a timer after disposal', () => {
    const harness = createController('up-to-date')
    harness.open.value = true
    harness.controller.dispose()

    vi.advanceTimersByTime(100)
    expect(harness.open.value).toBe(true)
  })
})

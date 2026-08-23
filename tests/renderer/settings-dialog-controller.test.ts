import { describe, expect, it, vi } from 'vitest'
import {
  useSettingsDialogController,
  type SettingsSection
} from '../../src/renderer/src/composables/useSettingsDialogController.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((next) => { resolve = next })
  return { promise, resolve }
}

function createController(options: {
  resetSection?: (section: SettingsSection) => boolean | void | Promise<boolean | void>
  isResetDisabled?: (section: string) => boolean
} = {}) {
  const beforeOpen = vi.fn()
  const resetSection = vi.fn(options.resetSection ?? (async () => true))
  const onResetError = vi.fn()
  const controller = useSettingsDialogController({
    beforeOpen,
    resetSection,
    isResetDisabled: (section) => options.isResetDisabled?.(section) ?? false,
    onResetError
  })
  return { beforeOpen, controller, onResetError, resetSection }
}

describe('settings dialog controller', () => {
  it('opens a requested section, toggles closed, and restores the same section', () => {
    const { beforeOpen, controller } = createController()

    controller.openSection('search')
    expect(controller.open.value).toBe(true)
    expect(controller.section.value).toBe('search')
    controller.toggle()
    expect(controller.open.value).toBe(false)
    controller.toggle()

    expect(controller.open.value).toBe(true)
    expect(controller.section.value).toBe('search')
    expect(beforeOpen).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('serializes reset clicks and exposes the pending state', async () => {
    const resetting = deferred()
    const resetSection = vi.fn(() => resetting.promise)
    const { controller } = createController({ resetSection })
    controller.openSection('appearance')

    const first = controller.resetCurrent()
    await expect(controller.resetCurrent()).resolves.toBe(false)

    expect(resetSection).toHaveBeenCalledOnce()
    expect(controller.resetDisabled.value).toBe(true)
    resetting.resolve()
    await expect(first).resolves.toBe(true)
    expect(controller.resetDisabled.value).toBe(false)
    controller.dispose()
  })

  it('respects child busy state and sections without reset behavior', async () => {
    const { controller, resetSection } = createController({
      isResetDisabled: (section) => section === 'downloads'
    })

    controller.openSection('downloads')
    await expect(controller.resetCurrent()).resolves.toBe(false)
    controller.openSection('credentials')
    expect(controller.resetVisible.value).toBe(false)
    await expect(controller.resetCurrent()).resolves.toBe(false)

    expect(resetSection).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('reports reset failures and releases the reset lock', async () => {
    const failure = new Error('disk full')
    const resetSection = vi.fn(async () => { throw failure })
    const { controller, onResetError } = createController({ resetSection })

    await expect(controller.resetCurrent()).resolves.toBe(false)

    expect(onResetError).toHaveBeenCalledWith(failure)
    expect(controller.resetBusy.value).toBe(false)
    controller.dispose()
  })
})

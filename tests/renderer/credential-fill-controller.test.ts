import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useCredentialFillController } from '../../src/renderer/src/composables/useCredentialFillController.js'
import type { BrowserTabState, CredentialSummary } from '../../src/shared/types.js'

function tab(id = 'tab-1'): BrowserTabState {
  return {
    id,
    title: 'Sign in',
    url: 'https://example.test/login',
    loading: false,
    navigationGeneration: 0,
    canGoBack: false,
    canGoForward: false,
    active: true,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs: true,
    zoomPercent: 100,
    audible: false,
    muted: false,
    devToolsOpen: false
  }
}

function credential(id = 'credential-1', username = 'Person'): CredentialSummary {
  return {
    id,
    origin: 'https://example.test',
    username,
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z'
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function create(
  initialCredentials = [credential()],
  missingCredentialMessage = () => 'Page no longer matches this password'
) {
  const activeTab = ref<BrowserTabState | undefined>(tab())
  const activeCredentials = ref(initialCredentials)
  const pickerOpen = ref(false)
  const openPicker = vi.fn(async () => { pickerOpen.value = true })
  const fillCredential = vi.fn(async () => true)
  const onFilled = vi.fn()
  const onError = vi.fn()
  const controller = useCredentialFillController({
    activeTab,
    activeCredentials,
    pickerOpen,
    openPicker,
    fillCredential,
    missingCredentialMessage,
    onFilled,
    onError
  })
  return {
    activeTab,
    activeCredentials,
    pickerOpen,
    openPicker,
    fillCredential,
    onFilled,
    onError,
    controller
  }
}

describe('credential fill controller', () => {
  it('fills the only matching credential or opens the account picker for multiple matches', async () => {
    const single = create()
    await single.controller.fillSavedPassword()

    expect(single.fillCredential).toHaveBeenCalledWith('tab-1', 'credential-1')
    expect(single.onFilled).toHaveBeenCalledWith(expect.objectContaining({ id: 'credential-1' }))
    expect(single.openPicker).not.toHaveBeenCalled()

    const multiple = create([credential('first'), credential('second')])
    await multiple.controller.fillSavedPassword()

    expect(multiple.openPicker).toHaveBeenCalledOnce()
    expect(multiple.fillCredential).not.toHaveBeenCalled()
  })

  it('ignores a duplicate fill while the first request is pending', async () => {
    const pending = deferred<boolean>()
    const harness = create()
    harness.fillCredential.mockImplementation(() => pending.promise)

    const first = harness.controller.fillSelectedCredential(credential())
    await Promise.resolve()
    const duplicate = harness.controller.fillSelectedCredential(credential('credential-2'))

    expect(harness.controller.state.value).toBe('filling')
    expect(harness.fillCredential).toHaveBeenCalledTimes(1)
    pending.resolve(true)
    await Promise.all([first, duplicate])
    expect(harness.controller.state.value).toBe('idle')
  })

  it('closes the picker and reports a rejected stale document before becoming retryable', async () => {
    const harness = create()
    harness.pickerOpen.value = true
    harness.fillCredential.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await harness.controller.fillSelectedCredential(credential())

    expect(harness.pickerOpen.value).toBe(false)
    expect(harness.onError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Page no longer matches this password'
    }))
    expect(harness.controller.state.value).toBe('idle')

    await harness.controller.fillSelectedCredential(credential())
    expect(harness.fillCredential).toHaveBeenCalledTimes(2)
  })

  it('reports a rejected stale document in the current interface language', async () => {
    let language: 'English' | 'Deutsch' = 'English'
    const translate = () => language === 'English'
      ? 'Page no longer matches this password'
      : 'Die Seite stimmt nicht mehr mit diesem Passwort überein'
    const harness = create([credential()], translate)
    harness.fillCredential.mockResolvedValueOnce(false)

    language = 'Deutsch'
    await harness.controller.fillSelectedCredential(credential())

    expect(harness.onError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Die Seite stimmt nicht mehr mit diesem Passwort überein'
    }))
  })

  it('suppresses delayed success feedback after the active tab changes', async () => {
    const pending = deferred<boolean>()
    const harness = create()
    harness.fillCredential.mockImplementation(() => pending.promise)

    const fill = harness.controller.fillSelectedCredential(credential())
    await Promise.resolve()
    harness.activeTab.value = tab('tab-2')
    pending.resolve(true)
    await fill

    expect(harness.fillCredential).toHaveBeenCalledWith('tab-1', 'credential-1')
    expect(harness.onFilled).not.toHaveBeenCalled()
    expect(harness.onError).not.toHaveBeenCalled()
    expect(harness.controller.state.value).toBe('idle')
  })

  it('suppresses delayed failure feedback after the active page navigates', async () => {
    const pending = deferred<boolean>()
    const harness = create()
    harness.fillCredential.mockImplementation(() => pending.promise)

    const fill = harness.controller.fillSelectedCredential(credential())
    await Promise.resolve()
    harness.activeTab.value = {
      ...tab(),
      url: 'https://example.test/another-page'
    }
    pending.reject(new Error('The original document was replaced'))
    await fill

    expect(harness.fillCredential).toHaveBeenCalledWith('tab-1', 'credential-1')
    expect(harness.onFilled).not.toHaveBeenCalled()
    expect(harness.onError).not.toHaveBeenCalled()
    expect(harness.controller.state.value).toBe('idle')
  })

  it('does nothing without an active tab or matching credential', async () => {
    const harness = create([])
    await harness.controller.fillSavedPassword()
    harness.activeTab.value = undefined
    await harness.controller.fillSelectedCredential(credential())

    expect(harness.openPicker).not.toHaveBeenCalled()
    expect(harness.fillCredential).not.toHaveBeenCalled()
    expect(harness.onError).not.toHaveBeenCalled()
  })
})

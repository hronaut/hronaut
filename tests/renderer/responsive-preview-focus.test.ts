import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ResponsivePreviewPanel from '../../src/renderer/src/features/emulation/ResponsivePreviewPanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserState, BrowserTabState } from '../../src/shared/types.js'
import { resolveViewportPreset } from '../../src/shared/viewport-presets.js'

function browserTab(emulated = false): BrowserTabState {
  return {
    id: 'tab-1',
    url: 'https://example.test/',
    title: 'Example',
    ...(emulated ? { emulation: { viewport: resolveViewportPreset('tablet') } } : {})
  } as BrowserTabState
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function renderPanel(pending: Promise<BrowserState>, emulated = false) {
  let mutation = 0
  return render(ResponsivePreviewPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      open: true,
      dock: 'right',
      activeTab: browserTab(emulated),
      locale: 'en-US',
      setTabViewport: vi.fn(() => pending),
      syncState: async (operation: Promise<BrowserState>) => { await operation },
      beginMutation: () => ++mutation,
      isMutationCurrent: (sequence: number) => sequence === mutation,
      closeTransientPanels: vi.fn(),
      keepsSeparatePanelOpen: () => false
    }
  })
}

// JSDOM keeps focus on a control that becomes disabled; Chromium moves it to the document body.
function dropFocusLikeChromium(control: HTMLElement): void {
  control.removeAttribute('disabled')
  control.blur()
  control.setAttribute('disabled', '')
  expect(document.body).toHaveFocus()
}

afterEach(() => vi.restoreAllMocks())

describe('ResponsivePreviewPanel focus after an action', () => {
  // Apply preview is disabled while the viewport applies, so Chromium moved its focus to the document body and nothing
  // gave it back: the next Tab started at the top of the window.
  it.each(['applies', 'fails'] as const)('gives the focus back to Apply preview once the viewport %s', async (outcome) => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const pending = deferred<BrowserState>()
    const view = renderPanel(pending.promise)
    const apply = screen.getByRole('button', { name: 'Apply preview' })
    await userEvent.setup().click(apply)
    expect(apply).toBeDisabled()
    dropFocusLikeChromium(apply)

    if (outcome === 'applies') pending.resolve({} as BrowserState)
    else pending.reject(new Error('Viewport service unavailable'))

    await vi.waitFor(() => expect(apply).toBeEnabled())
    await vi.waitFor(() => expect(apply).toHaveFocus())
    view.unmount()
  })

  // Reset viewport stays disabled once nothing is emulated. Not to a preset or a field: Enter on a field submits the
  // form, so a held Enter would apply the draft again right after you reset it.
  it('moves the focus to the panel once Reset viewport succeeds and stays disabled', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const pending = deferred<BrowserState>()
    const view = renderPanel(pending.promise, true)
    const reset = screen.getByRole('button', { name: 'Reset viewport' })
    await userEvent.setup().click(reset)
    expect(reset).toBeDisabled()
    dropFocusLikeChromium(reset)

    await view.rerender({ activeTab: browserTab(false) })
    pending.resolve({} as BrowserState)

    const panel = screen.getByRole('dialog', { name: 'Responsive preview' })
    await vi.waitFor(() => expect(panel).toHaveAttribute('aria-busy', 'false'))
    await vi.waitFor(() => expect(panel).toHaveFocus())
    expect(reset).toBeDisabled()
    view.unmount()
  })

  it('leaves newer focus alone when the viewport applies', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const pending = deferred<BrowserState>()
    const view = renderPanel(pending.promise)
    const apply = screen.getByRole('button', { name: 'Apply preview' })
    await userEvent.setup().click(apply)
    dropFocusLikeChromium(apply)
    const landscape = screen.getByRole('button', { name: 'Landscape' })
    landscape.focus()

    pending.resolve({} as BrowserState)
    await vi.waitFor(() => expect(apply).toBeEnabled())
    expect(landscape).toHaveFocus()
    view.unmount()
  })

  it('leaves the focus alone when the panel closed while the viewport applied', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const pending = deferred<BrowserState>()
    const view = renderPanel(pending.promise)
    const apply = screen.getByRole('button', { name: 'Apply preview' })
    await userEvent.setup().click(apply)
    dropFocusLikeChromium(apply)

    await view.rerender({ open: false })
    pending.resolve({} as BrowserState)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.body).toHaveFocus()
    view.unmount()
  })
})

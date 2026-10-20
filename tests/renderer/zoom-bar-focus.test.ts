import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ZoomBar from '../../src/renderer/src/components/ZoomBar.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserState, BrowserTabState } from '../../src/shared/types.js'

function tab(zoomPercent: number): BrowserTabState {
  return {
    id: 'first',
    title: 'Page',
    url: 'https://example.test/first',
    loading: false,
    navigationGeneration: 0,
    canGoBack: false,
    canGoForward: false,
    active: true,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs: false,
    zoomPercent,
    audible: false,
    muted: false,
    devToolsOpen: false
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

function renderBar(zoomPercent: number, pending: Promise<BrowserState>) {
  return render(ZoomBar, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      open: true,
      activeTab: tab(zoomPercent),
      browser: { setZoom: vi.fn(() => pending) },
      acceptState: async (next: Promise<BrowserState> | BrowserState) => { await next },
      formatPercent: (value: number) => `${value}%`
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

describe('ZoomBar focus after a zoom change', () => {
  // Every zoom control is disabled while the change applies, so Chromium moved the focus of the one you used to the
  // document body: pressing Enter again on Zoom in did nothing, and the next Tab started at the top of the window.
  it.each([
    ['Zoom in', 'applies'],
    ['Zoom out', 'applies'],
    ['Zoom in', 'fails']
  ] as const)('gives the focus back to %s once the change %s', async (name, outcome) => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const pending = deferred<BrowserState>()
    const view = renderBar(110, pending.promise)
    const control = screen.getByRole('button', { name })
    await userEvent.setup().click(control)
    expect(control).toBeDisabled()
    dropFocusLikeChromium(control)

    if (outcome === 'applies') {
      await view.rerender({ activeTab: tab(name === 'Zoom in' ? 125 : 100) })
      pending.resolve({} as BrowserState)
    } else pending.reject(new Error('tab disappeared'))

    await vi.waitFor(() => expect(control).toBeEnabled())
    await vi.waitFor(() => expect(control).toHaveFocus())
    view.unmount()
  })

  // Reset is disabled at 100%, and Zoom in or Close would run on a held Enter, so the bar itself takes the focus.
  it('moves the focus to the zoom bar once Reset brings the page to 100%', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const pending = deferred<BrowserState>()
    const view = renderBar(150, pending.promise)
    const reset = screen.getByRole('button', { name: 'Reset' })
    await userEvent.setup().click(reset)
    dropFocusLikeChromium(reset)

    await view.rerender({ activeTab: tab(100) })
    pending.resolve({} as BrowserState)

    const controls = screen.getByRole('group', { name: 'Page zoom controls' })
    await vi.waitFor(() => expect(controls).toHaveAttribute('aria-busy', 'false'))
    await vi.waitFor(() => expect(controls).toHaveFocus())
    expect(reset).toBeDisabled()
    view.unmount()
  })

  it('leaves the focus alone when the zoom bar closed while the change applied', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const pending = deferred<BrowserState>()
    const view = renderBar(110, pending.promise)
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' })
    await userEvent.setup().click(zoomIn)
    dropFocusLikeChromium(zoomIn)

    await view.rerender({ open: false })
    pending.resolve({} as BrowserState)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.body).toHaveFocus()
    view.unmount()
  })
})

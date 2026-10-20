import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ResponsivePreviewPanel from '../../src/renderer/src/components/ResponsivePreviewPanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserState, BrowserTabState } from '../../src/shared/types.js'
import { resolveViewportPreset } from '../../src/shared/viewport-presets.js'

function browserState(): BrowserState {
  return {} as BrowserState
}

function browserTab(): BrowserTabState {
  return {
    id: 'tab-1',
    url: 'https://example.test/',
    title: 'Example'
  } as BrowserTabState
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function renderPanel(overrides: Record<string, unknown> = {}) {
  let mutation = 0
  return render(ResponsivePreviewPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      open: true,
      dock: 'right',
      activeTab: browserTab(),
      locale: 'en-US',
      setTabViewport: vi.fn(async () => browserState()),
      syncState: vi.fn(async (operation: Promise<BrowserState>) => { await operation }),
      beginMutation: () => ++mutation,
      isMutationCurrent: (sequence: number) => sequence === mutation,
      closeTransientPanels: vi.fn(),
      keepsSeparatePanelOpen: () => false,
      ...overrides
    }
  })
}

describe('ResponsivePreviewPanel', () => {
  it('keeps a newer draft visible when an earlier apply request finishes', async () => {
    const pending = deferred<BrowserState>()
    const setTabViewport = vi.fn(() => pending.promise)
    const syncState = vi.fn(async (operation: Promise<BrowserState>) => { await operation })
    renderPanel({ setTabViewport, syncState })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /^Tablet/ }))
    await user.click(screen.getByRole('button', { name: 'Landscape' }))
    await user.click(screen.getByRole('button', { name: 'Apply preview' }))
    expect(screen.getByRole('dialog', { name: 'Responsive preview' })).toHaveAttribute('aria-busy', 'true')

    await user.click(screen.getByRole('button', { name: /^Desktop/ }))
    pending.resolve(browserState())
    await vi.waitFor(() => expect(screen.getByRole('dialog', { name: 'Responsive preview' })).toHaveAttribute('aria-busy', 'false'))

    expect(syncState).toHaveBeenCalledOnce()
    expect(screen.getByText('Preview conditions')).toBeVisible()
    expect(screen.queryByText('Viewport applied')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Desktop/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('dialog', { name: 'Responsive preview' })).toHaveAttribute('aria-busy', 'false')
  })

  it('shows apply failures and enables retrying the retained selection', async () => {
    const setTabViewport = vi.fn()
      .mockRejectedValueOnce(new Error('Viewport service unavailable'))
      .mockResolvedValueOnce(browserState())
    renderPanel({ setTabViewport })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /^Laptop/ }))
    await user.click(screen.getByRole('button', { name: 'Apply preview' }))
    expect(await screen.findByText('Viewport service unavailable')).toBeVisible()
    expect(screen.getByRole('button', { name: /^Laptop/ })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Apply preview' }))
    expect(await screen.findByText('Viewport applied')).toBeVisible()
    expect(setTabViewport).toHaveBeenCalledTimes(2)
  })

  it('prevents unsupported custom dimensions from being submitted', async () => {
    const setTabViewport = vi.fn(async () => browserState())
    renderPanel({ setTabViewport })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /^Custom/ }))
    const width = screen.getByRole('spinbutton', { name: 'Width' })
    await user.clear(width)
    await user.type(width, '199')

    expect(screen.getByRole('button', { name: 'Apply preview' })).toBeDisabled()
    expect(screen.getByText('Enter a width and height from 200 to 3840, with DPR from 0.5 to 5.')).toBeVisible()
    expect(setTabViewport).not.toHaveBeenCalled()
  })

  it('emits dock and close model changes', async () => {
    const view = renderPanel()
    const user = userEvent.setup()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Dock responsive preview' }), 'bottom')
    await user.click(screen.getByRole('button', { name: 'Close responsive preview' }))

    expect(view.emitted()['update:dock']?.at(-1)).toEqual(['bottom'])
    expect(view.emitted()['update:open']?.at(-1)).toEqual([false])
  })
})

describe('Responsive preview docked back from its window', () => {
  // The panel stayed open while it was in its own window, so docked back it kept the draft it had before it left, and
  // Apply preview put that viewport back over the one applied in the window.
  const tablet = { ...browserTab(), emulation: { viewport: resolveViewportPreset('tablet') } } as BrowserTabState

  const tabletPreset = () => screen.getByRole('button', { name: /^Tablet/ })

  it('shows the tab’s viewport as it is now', async () => {
    const view = renderPanel({ dock: 'window' })
    expect(tabletPreset().getAttribute('aria-pressed')).toBe('false')
    await view.rerender({ dock: 'window', activeTab: tablet })
    expect(tabletPreset().getAttribute('aria-pressed')).toBe('false')
    await view.rerender({ dock: 'right', activeTab: tablet })
    expect(tabletPreset().getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps the draft in the panel window as it docks back and closes', async () => {
    const view = renderPanel({ dock: 'window', keepsSeparatePanelOpen: () => true })
    await view.rerender({ dock: 'right', activeTab: tablet })
    expect(tabletPreset().getAttribute('aria-pressed')).toBe('false')
  })
})

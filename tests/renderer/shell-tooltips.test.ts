import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInWindowTooltipPort } from '../../src/renderer/src/composables/in-window-tooltips.js'
import { installShellTooltips, SHELL_TOOLTIP_DELAY_MS, SHELL_TOOLTIP_SETTLE_MS, SHELL_TOOLTIP_WARM_MS } from '../../src/renderer/src/composables/shell-tooltips.js'
import { vTooltip } from '../../src/renderer/src/ui/tooltip.js'
import type { ShellTooltipRequest } from '../../src/shared/shell-tooltip.js'

function control(text: string, label?: string): HTMLButtonElement {
  const button = document.createElement('button')
  if (label) button.setAttribute('aria-label', label)
  button.dataset.tooltip = text
  const icon = document.createElement('svg')
  button.append(icon)
  button.getBoundingClientRect = () => ({ left: 600, top: 8, width: 32, height: 32, right: 632, bottom: 40, x: 600, y: 8, toJSON: () => ({}) })
  document.body.append(button)
  return button
}

function pointer(type: 'pointerover' | 'pointerout' | 'pointerdown', target: Element, relatedTarget: Element | null = null): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget }))
}

function tooltipPort() {
  return { showTooltip: vi.fn<(request: ShellTooltipRequest) => void>(), hideTooltip: vi.fn<(id?: number) => void>() }
}

let uninstall: (() => void) | undefined

beforeEach(() => {
  vi.useFakeTimers()
  document.documentElement.dataset.theme = 'matrix'
})

afterEach(() => {
  uninstall?.()
  uninstall = undefined
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.replaceChildren()
  delete document.documentElement.dataset.theme
})

describe('shell tooltips', () => {
  it('shows the tooltip of the control the pointer rests on, with its box, side and theme', () => {
    const port = tooltipPort()
    uninstall = installShellTooltips(port)
    const rail = document.createElement('nav')
    rail.dataset.tooltipPlacement = 'right'
    document.body.append(rail)
    const button = control('Back (Alt+Left)', 'Back')
    rail.append(button)

    // Entering the icon inside the control counts as the control.
    pointer('pointerover', button.firstElementChild!)
    vi.advanceTimersByTime(SHELL_TOOLTIP_DELAY_MS - 1)
    expect(port.showTooltip).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(port.showTooltip).toHaveBeenCalledExactlyOnceWith({
      id: 1,
      text: 'Back (Alt+Left)',
      anchor: { x: 600, y: 8, width: 32, height: 32 },
      placement: 'right',
      theme: 'matrix'
    })

    pointer('pointerout', button, document.body)
    expect(port.hideTooltip).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('shows the next control at once while warm, and nothing for a control left before the delay', () => {
    const port = tooltipPort()
    uninstall = installShellTooltips(port)
    const first = control('Commands')
    const second = control('Search tabs')
    const third = control('Downloads')

    pointer('pointerover', first)
    vi.advanceTimersByTime(SHELL_TOOLTIP_DELAY_MS)
    pointer('pointerout', first, second)
    pointer('pointerover', second, first)
    expect(port.showTooltip).toHaveBeenLastCalledWith(expect.objectContaining({ id: 2, text: 'Search tabs' }))

    pointer('pointerout', second, document.body)
    vi.advanceTimersByTime(SHELL_TOOLTIP_WARM_MS)
    pointer('pointerover', third)
    pointer('pointerout', third, document.body)
    vi.advanceTimersByTime(SHELL_TOOLTIP_DELAY_MS * 2)
    expect(port.showTooltip).toHaveBeenCalledTimes(2)
  })

  it('hides on a click and keeps the clicked control quiet until the pointer leaves it', () => {
    const port = tooltipPort()
    uninstall = installShellTooltips(port)
    const button = control('Mute all tabs')
    pointer('pointerover', button)
    vi.advanceTimersByTime(SHELL_TOOLTIP_DELAY_MS)
    pointer('pointerdown', button)
    expect(port.hideTooltip).toHaveBeenCalledWith(1)
    pointer('pointerover', button.firstElementChild!)
    vi.advanceTimersByTime(SHELL_TOOLTIP_DELAY_MS)
    expect(port.showTooltip).toHaveBeenCalledOnce()

    pointer('pointerout', button, document.body)
    vi.advanceTimersByTime(SHELL_TOOLTIP_WARM_MS)
    pointer('pointerover', button)
    vi.advanceTimersByTime(SHELL_TOOLTIP_DELAY_MS)
    expect(port.showTooltip).toHaveBeenCalledTimes(2)
  })

  it('follows a control whose text changes and hides when it leaves the page, a key is pressed or the window blurs', async () => {
    const port = tooltipPort()
    uninstall = installShellTooltips(port)
    const button = control('Reload')
    pointer('pointerover', button)
    vi.advanceTimersByTime(SHELL_TOOLTIP_DELAY_MS)
    button.dataset.tooltip = 'Stop'
    await vi.waitFor(() => expect(port.showTooltip).toHaveBeenLastCalledWith(expect.objectContaining({ id: 2, text: 'Stop' })))
    expect(port.hideTooltip).toHaveBeenCalledWith(1)

    button.remove()
    await vi.waitFor(() => expect(port.hideTooltip).toHaveBeenLastCalledWith(2))

    for (const end of [
      () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })),
      () => window.dispatchEvent(new Event('blur'))
    ]) {
      const next = control('Settings')
      pointer('pointerover', next)
      vi.advanceTimersByTime(SHELL_TOOLTIP_DELAY_MS)
      const shown = port.showTooltip.mock.lastCall![0].id
      end()
      expect(port.hideTooltip).toHaveBeenLastCalledWith(shown)
      pointer('pointerout', next, document.body)
      next.remove()
    }
  })

  // A panel in its own window showed the operating system's tooltip, from a native title, instead of the themed one.
  it('draws the themed tooltip in the page itself in a panel window, never as a native title', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 24 } as DOMRect)
    uninstall = installShellTooltips(createInWindowTooltipPort())
    const button = control('Clear console')
    pointer('pointerover', button)
    expect(document.querySelector('.shell-window-tooltip')).toBeNull()
    vi.advanceTimersByTime(SHELL_TOOLTIP_DELAY_MS)

    const tooltip = document.querySelector<HTMLElement>('.shell-window-tooltip')
    expect(tooltip?.textContent).toBe('Clear console')
    expect(tooltip?.style).toMatchObject({ left: '566px', top: '46px', visibility: '' })
    expect(button.hasAttribute('title')).toBe(false)
    pointer('pointerout', button, document.body)
    expect(document.querySelector('.shell-window-tooltip')).toBeNull()
  })

  it('hides for a scroll that moves the control, not for one in an unrelated list', () => {
    const port = tooltipPort()
    uninstall = installShellTooltips(port)
    const toolbar = document.createElement('div')
    const list = document.createElement('div')
    document.body.append(toolbar, list)
    const button = control('Downloads')
    toolbar.append(button)
    pointer('pointerover', button)
    vi.advanceTimersByTime(SHELL_TOOLTIP_DELAY_MS)
    list.dispatchEvent(new Event('scroll'))
    expect(port.hideTooltip).not.toHaveBeenCalled()
    toolbar.dispatchEvent(new Event('scroll'))
    expect(port.hideTooltip).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('shows the tooltip beside a control again once it stops resizing, as in a rail that expands', () => {
    let resized: (() => void) | undefined
    const observed: Element[] = []
    class FakeResizeObserver {
      constructor(callback: () => void) { resized = callback }
      observe(element: Element): void { observed.push(element) }
      disconnect(): void { resized = undefined }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    try {
      const port = tooltipPort()
      uninstall = installShellTooltips(port)
      const tab = control('Checkout · Acme Store')
      pointer('pointerover', tab)
      vi.advanceTimersByTime(SHELL_TOOLTIP_DELAY_MS)
      expect(observed).toEqual([tab])
      // The first report, for the box the tooltip was placed beside, changes nothing.
      resized!()
      expect(port.hideTooltip).not.toHaveBeenCalled()

      tab.getBoundingClientRect = () => ({ left: 8, top: 120, width: 120, height: 32, right: 128, bottom: 152, x: 8, y: 120, toJSON: () => ({}) })
      resized!()
      expect(port.hideTooltip).toHaveBeenCalledExactlyOnceWith(1)
      vi.advanceTimersByTime(SHELL_TOOLTIP_SETTLE_MS - 1)
      // Still resizing: wait for it to settle.
      resized!()
      vi.advanceTimersByTime(SHELL_TOOLTIP_SETTLE_MS - 1)
      expect(port.showTooltip).toHaveBeenCalledOnce()
      vi.advanceTimersByTime(1)
      expect(port.showTooltip).toHaveBeenLastCalledWith(expect.objectContaining({ id: 2, anchor: { x: 8, y: 120, width: 120, height: 32 } }))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('stops listening once uninstalled', () => {
    const port = tooltipPort()
    installShellTooltips(port)()
    pointer('pointerover', control('Commands'))
    vi.advanceTimersByTime(SHELL_TOOLTIP_DELAY_MS)
    expect(port.showTooltip).not.toHaveBeenCalled()
  })
})

describe('v-tooltip', () => {
  function bind(element: HTMLElement, value: string | null, oldValue: string | null = null): void {
    const binding = { value, oldValue, arg: undefined, modifiers: {}, instance: null, dir: vTooltip }
    if (oldValue === null && !element.dataset.bound) {
      element.dataset.bound = '1'
      ;(vTooltip.mounted as (element: HTMLElement, binding: unknown) => void)(element, binding)
    } else {
      ;(vTooltip.updated as (element: HTMLElement, binding: unknown) => void)(element, binding)
    }
  }

  it('marks the control for the tooltip controller and describes it when the text says more than its name', () => {
    const back = document.createElement('button')
    back.setAttribute('aria-label', 'Back')
    bind(back, 'Back (Alt+Left)')
    expect(back.dataset.tooltip).toBe('Back (Alt+Left)')
    expect(back.getAttribute('aria-description')).toBe('Back (Alt+Left)')
    expect(back.title).toBe('')

    // Repeating the name adds no description, and an empty text removes the tooltip.
    bind(back, 'Back', 'Back (Alt+Left)')
    expect(back.hasAttribute('aria-description')).toBe(false)
    bind(back, null, 'Back')
    expect(back.hasAttribute('data-tooltip')).toBe(false)
  })

  it('names an icon control that only had a title, and yields to a name or description the control binds later', () => {
    const remove = document.createElement('button')
    remove.append(document.createElement('svg'))
    bind(remove, 'Remove from list')
    expect(remove.getAttribute('aria-label')).toBe('Remove from list')
    expect(remove.hasAttribute('aria-description')).toBe(false)

    const header = document.createElement('button')
    header.textContent = 'Checkout'
    bind(header, 'Collapse Checkout')
    expect(header.getAttribute('aria-description')).toBe('Collapse Checkout')
    // The workspace gains a description of its own, bound before the directive updates.
    header.setAttribute('aria-description', 'Compare checkout flows.')
    bind(header, 'Collapse Checkout\n\nCompare checkout flows.', 'Collapse Checkout')
    expect(header.getAttribute('aria-description')).toBe('Compare checkout flows.')
    bind(header, null, 'Collapse Checkout\n\nCompare checkout flows.')
    expect(header.getAttribute('aria-description')).toBe('Compare checkout flows.')
  })

  it("never replaces or removes the control's own description", () => {
    const status = document.createElement('button')
    status.setAttribute('aria-description', 'Two agents connected')
    bind(status, 'MCP status')
    expect(status.getAttribute('aria-description')).toBe('Two agents connected')
    bind(status, null, 'MCP status')
    expect(status.getAttribute('aria-description')).toBe('Two agents connected')
  })
})

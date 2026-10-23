import {
  placeShellTooltip,
  SHELL_TOOLTIP_MAX_HEIGHT,
  SHELL_TOOLTIP_MAX_WIDTH,
  type ShellTooltipRequest
} from '../../../shared/shell-tooltip.js'
import type { ShellTooltipPort } from './shell-tooltips.js'

/**
 * Draws the shell's tooltips in its own page, for a window that has no page views over the shell, such as a panel
 * opened in its own window. The main window's page views cover the shell, so main draws its tooltips in a native
 * view instead. Placement follows main's: beside the control, flipped to the other side when there is no room, never
 * over the control.
 */
export function createInWindowTooltipPort(root: Document = document): ShellTooltipPort {
  const view = root.defaultView ?? window
  let shown: { id: number; element: HTMLElement } | null = null

  function place(request: ShellTooltipRequest, element: HTMLElement): void {
    if (shown?.element !== element || !element.isConnected) return
    const box = element.getBoundingClientRect()
    const position = placeShellTooltip(
      request.anchor,
      { width: Math.min(box.width, SHELL_TOOLTIP_MAX_WIDTH), height: Math.min(box.height, SHELL_TOOLTIP_MAX_HEIGHT) },
      request.placement,
      { width: view.innerWidth, height: view.innerHeight }
    )
    if (!position) {
      element.style.visibility = 'hidden'
      return
    }
    element.style.left = `${position.x}px`
    element.style.top = `${position.y}px`
    element.style.visibility = ''
  }

  function hideTooltip(id?: number): void {
    if (!shown || (id !== undefined && id !== shown.id)) return
    shown.element.remove()
    shown = null
  }

  return {
    showTooltip(request) {
      hideTooltip()
      const element = root.createElement('div')
      element.className = 'shell-window-tooltip'
      // The control carries the text as its name or description, as with main's tooltips.
      element.setAttribute('aria-hidden', 'true')
      element.textContent = request.text
      // Laid out unseen at the window's corner, then moved beside the control.
      element.style.visibility = 'hidden'
      root.body.append(element)
      shown = { id: request.id, element }
      place(request, element)
      // The first tooltip can lay out before the bundled font has loaded; place it again at its final size.
      void root.fonts?.ready.then(() => place(request, element))
    },
    hideTooltip
  }
}

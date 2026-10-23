import { onScopeDispose } from 'vue'
import { isResolvedThemeName } from '../../../shared/theme.js'
import {
  SHELL_TOOLTIP_PLACEMENTS,
  SHELL_TOOLTIP_TEXT_LIMIT,
  type ShellTooltipPlacement,
  type ShellTooltipRect,
  type ShellTooltipRequest
} from '../../../shared/shell-tooltip.js'

/** How long the pointer rests on a control before its tooltip appears. */
export const SHELL_TOOLTIP_DELAY_MS = 500
/** After a tooltip hides, the next control's tooltip appears at once for this long. */
export const SHELL_TOOLTIP_WARM_MS = 600
/** A control that resizes under its tooltip, such as in a rail that expands, shows it again once still this long. */
export const SHELL_TOOLTIP_SETTLE_MS = 150

export interface ShellTooltipPort {
  showTooltip(request: ShellTooltipRequest): void
  hideTooltip(id?: number): void
}

function triggerFor(node: EventTarget | null): HTMLElement | null {
  return node instanceof Element ? node.closest<HTMLElement>('[data-tooltip]') : null
}

function sameBox(box: DOMRect, anchor: ShellTooltipRect): boolean {
  return Math.abs(box.left - anchor.x) < 1 && Math.abs(box.top - anchor.y) < 1
    && Math.abs(box.width - anchor.width) < 1 && Math.abs(box.height - anchor.height) < 1
}

function placementFor(trigger: HTMLElement): ShellTooltipPlacement {
  const value = trigger.closest<HTMLElement>('[data-tooltip-placement]')?.dataset.tooltipPlacement
  return (SHELL_TOOLTIP_PLACEMENTS as readonly string[]).includes(value ?? '') ? value as ShellTooltipPlacement : 'bottom'
}

/**
 * Shows the `v-tooltip` text of the control under the pointer as a themed tooltip. In the main
 * window, main draws it in a native view above the page, where the shell's DOM cannot reach; a
 * panel window draws it in its own page (in-window-tooltips.ts).
 */
export function installShellTooltips(port: ShellTooltipPort, root: Document = document): () => void {
  const view = root.defaultView ?? window
  let trigger: HTMLElement | null = null
  // A clicked control shows no tooltip again until the pointer leaves it.
  let suppressed: HTMLElement | null = null
  let shownId = 0
  let nextId = 0
  let warmUntil = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let observer: MutationObserver | null = null
  let resizer: ResizeObserver | null = null

  function stopObserving(): void {
    observer?.disconnect()
    observer = null
    resizer?.disconnect()
    resizer = null
  }

  function hide(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    stopObserving()
    if (!shownId) return
    port.hideTooltip(shownId)
    shownId = 0
    warmUntil = Date.now() + SHELL_TOOLTIP_WARM_MS
  }

  function show(target: HTMLElement): void {
    timer = undefined
    const text = target.dataset.tooltip?.trim()
    if (!text || !target.isConnected || target !== trigger) return
    const box = target.getBoundingClientRect()
    if (box.width <= 0 && box.height <= 0) return
    const theme = root.documentElement.dataset.theme
    const anchor = { x: box.left, y: box.top, width: box.width, height: box.height }
    shownId = ++nextId
    port.showTooltip({
      id: shownId,
      text: text.slice(0, SHELL_TOOLTIP_TEXT_LIMIT),
      anchor,
      placement: placementFor(target),
      theme: isResolvedThemeName(theme) ? theme : 'dark'
    })
    stopObserving()
    // A control that changes its text, or leaves the page, takes its tooltip along.
    observer = new MutationObserver(() => {
      if (!target.isConnected) {
        hide()
        trigger = null
      } else if (target.dataset.tooltip?.trim() !== text) {
        hide()
        show(target)
      }
    })
    observer.observe(root.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-tooltip'] })
    // A control that resizes, such as a tab in a rail that expands under the pointer, would leave its
    // tooltip over its new box. Hide it, and show it beside the control once the control is still.
    if (typeof view.ResizeObserver !== 'function') return
    resizer = new view.ResizeObserver(() => {
      if (target !== trigger || (shownId && sameBox(target.getBoundingClientRect(), anchor))) return
      if (shownId) {
        port.hideTooltip(shownId)
        shownId = 0
      }
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => show(target), SHELL_TOOLTIP_SETTLE_MS)
    })
    resizer.observe(target)
  }

  function enter(next: HTMLElement | null): void {
    if (next === trigger) return
    hide()
    trigger = next
    if (!next || next === suppressed) return
    if (Date.now() < warmUntil) show(next)
    else timer = setTimeout(() => show(next), SHELL_TOOLTIP_DELAY_MS)
  }

  function dismiss(): void {
    hide()
    suppressed = trigger
    trigger = null
  }

  const onPointerOver = (event: PointerEvent): void => enter(triggerFor(event.target))
  const onPointerOut = (event: PointerEvent): void => {
    const next = triggerFor(event.relatedTarget)
    if (suppressed && next !== suppressed) suppressed = null
    if (next !== trigger) enter(next)
  }
  const onBlur = (): void => {
    hide()
    trigger = null
  }
  const onVisibility = (): void => {
    if (root.visibilityState === 'hidden') onBlur()
  }
  // Only a scroll that moves the control dismisses its tooltip, not one in an unrelated list.
  const onScroll = (event: Event): void => {
    const scrolled = event.target
    if (!trigger || scrolled === root || (scrolled instanceof Node && scrolled.contains(trigger))) onBlur()
  }

  root.addEventListener('pointerover', onPointerOver, true)
  root.addEventListener('pointerout', onPointerOut, true)
  root.addEventListener('pointerdown', dismiss, true)
  root.addEventListener('keydown', dismiss, true)
  root.addEventListener('wheel', onBlur, { capture: true, passive: true })
  root.addEventListener('scroll', onScroll, true)
  root.addEventListener('visibilitychange', onVisibility)
  view.addEventListener('blur', onBlur)
  // A window that resizes, maximizes or goes full screen moves the control away from its tooltip.
  view.addEventListener('resize', onBlur)

  return () => {
    hide()
    trigger = null
    root.removeEventListener('pointerover', onPointerOver, true)
    root.removeEventListener('pointerout', onPointerOut, true)
    root.removeEventListener('pointerdown', dismiss, true)
    root.removeEventListener('keydown', dismiss, true)
    root.removeEventListener('wheel', onBlur, true)
    root.removeEventListener('scroll', onScroll, true)
    root.removeEventListener('visibilitychange', onVisibility)
    view.removeEventListener('blur', onBlur)
    view.removeEventListener('resize', onBlur)
  }
}

/** Installs the shell's tooltips for the component's lifetime. */
export function useShellTooltips(port: ShellTooltipPort): void {
  onScopeDispose(installShellTooltips(port))
}

import './tooltip-overlay.css'
import type { ShellTooltipMeasurement, ShellTooltipState } from '../../shared/shell-tooltip.js'

interface HronautTooltipOverlayViewApi {
  onState(listener: (state: ShellTooltipState) => void): () => void
  measured(measurement: ShellTooltipMeasurement): void
}

declare global {
  interface Window {
    hronautTooltipOverlayView: HronautTooltipOverlayViewApi
  }
}

const root = document.querySelector<HTMLElement>('#tooltip-overlay-root')
if (!root) throw new Error('Tooltip overlay root is unavailable')
const overlayRoot = root

let currentId = 0
let reported = ''

function measure(id: number, element: HTMLElement): void {
  if (id !== currentId) return
  // Reading the box performs layout while the view is still hidden; a hidden view may never produce a frame.
  const box = element.getBoundingClientRect()
  const measurement = { id, width: Math.ceil(box.width), height: Math.ceil(box.height) }
  const key = `${id}:${measurement.width}x${measurement.height}`
  if (key === reported || measurement.width < 1 || measurement.height < 1) return
  reported = key
  window.hronautTooltipOverlayView.measured(measurement)
}

function render(state: ShellTooltipState): void {
  currentId = state.id
  document.documentElement.dataset.theme = state.theme
  const tooltip = document.createElement('div')
  tooltip.className = 'tooltip-overlay'
  tooltip.setAttribute('role', 'tooltip')
  tooltip.dir = 'auto'
  tooltip.textContent = state.text
  overlayRoot.replaceChildren(tooltip)
  measure(state.id, tooltip)
  // The first tooltip can lay out before the bundled font has loaded; report its final size too.
  void document.fonts?.ready.then(() => measure(state.id, tooltip))
}

window.hronautTooltipOverlayView.onState(render)

import './status-bubble.css'
import type { StatusBubbleMeasurement, StatusBubbleState } from '../../shared/status-bubble.js'

interface HronautStatusBubbleViewApi {
  onState(listener: (state: StatusBubbleState) => void): () => void
  measured(measurement: StatusBubbleMeasurement): void
}

declare global {
  interface Window {
    hronautStatusBubbleView: HronautStatusBubbleViewApi
  }
}

const root = document.querySelector<HTMLElement>('#status-bubble-root')
if (!root) throw new Error('Status bubble root is unavailable')
const bubbleRoot = root

let currentId = 0
let reported = ''

function part(className: string, text: string): HTMLElement {
  const element = document.createElement('span')
  element.className = className
  element.textContent = text
  return element
}

function overflows(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth
}

// As Chrome shortens an address: the rest first, at its end, then, when even the host does not fit, the start of the
// host, so the end of the host, which names the site, stays in view.
function fit(bubble: HTMLElement, rest: HTMLElement): boolean {
  bubble.classList.remove('status-bubble--long-host')
  if (overflows(bubble)) {
    bubble.classList.add('status-bubble--long-host')
    return true
  }
  return overflows(rest)
}

function measure(id: number, bubble: HTMLElement, rest: HTMLElement): void {
  if (id !== currentId) return
  // Reading the box performs layout while the view is still hidden; a hidden view may never produce a frame.
  const shortened = fit(bubble, rest)
  const box = bubble.getBoundingClientRect()
  const measurement = { id, width: Math.ceil(box.width), height: Math.ceil(box.height), shortened }
  const key = `${id}:${measurement.width}x${measurement.height}:${shortened}`
  if (key === reported || measurement.width < 1 || measurement.height < 1) return
  reported = key
  window.hronautStatusBubbleView.measured(measurement)
}

function render(state: StatusBubbleState): void {
  currentId = state.id
  // Every state gets its measurement, even with the id and size of an earlier one; only a repeat for the font is dropped.
  reported = ''
  document.documentElement.dataset.theme = state.theme
  const bubble = document.createElement('div')
  bubble.className = 'status-bubble'
  bubble.dataset.side = state.side
  // Only a bubble coming into sight fades in; another link, a corner change or widening shows at once.
  if (state.opening) bubble.dataset.opening = 'true'
  bubble.style.setProperty('--status-bubble-max-width', `${state.maxWidth}px`)
  bubble.style.setProperty('--status-bubble-corner', `${state.corner}px`)
  // An address reads left to right, whatever the text in it, as in Chrome.
  bubble.dir = 'ltr'
  const host = part('status-bubble__host', '')
  const hostText = part('status-bubble__host-text', state.text.host)
  hostText.dir = 'ltr'
  host.append(hostText)
  const rest = part('status-bubble__rest', state.text.rest)
  bubble.append(part('status-bubble__scheme', state.text.scheme), host, rest)
  bubbleRoot.replaceChildren(bubble)
  measure(state.id, bubble, rest)
  // The first bubble can lay out before the bundled font has loaded; report its final size too.
  void document.fonts?.ready.then(() => measure(state.id, bubble, rest))
}

window.hronautStatusBubbleView.onState(render)

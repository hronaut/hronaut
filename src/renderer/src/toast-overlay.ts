import './toast-overlay.css'
import type { ToastOverlayMeasurement, ToastOverlayMessage, ToastOverlayState, ToastOverlayTone } from '../../shared/toast-overlay.js'

interface HronautToastOverlayViewApi {
  onState(listener: (state: ToastOverlayState) => void): () => void
  measured(measurement: ToastOverlayMeasurement): void
  send(message: ToastOverlayMessage): void
}

declare global {
  interface Window {
    hronautToastOverlayView: HronautToastOverlayViewApi
  }
}

const SVG = 'http://www.w3.org/2000/svg'
// Material Symbols rounded, as the shell's own copy of the toast draws them.
const MARKS: Record<ToastOverlayTone, string> = {
  success: 'm9.55 15.15l8.475-8.475q.3-.3.7-.3t.7.3t.3.713t-.3.712l-9.175 9.2q-.3.3-.7.3t-.7-.3L4.55 13q-.3-.3-.288-.712t.313-.713t.713-.3t.712.3z',
  error: 'M12.713 16.713Q13 16.425 13 16t-.288-.712T12 15t-.712.288T11 16t.288.713T12 17t.713-.288m0-4Q13 12.425 13 12V8q0-.425-.288-.712T12 7t-.712.288T11 8v4q0 .425.288.713T12 13t.713-.288M12 22q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22m0-2q3.35 0 5.675-2.325T20 12t-2.325-5.675T12 4T6.325 6.325T4 12t2.325 5.675T12 20m0-8',
  info: 'M12.713 16.713Q13 16.425 13 16v-4q0-.425-.288-.712T12 11t-.712.288T11 12v4q0 .425.288.713T12 17t.713-.288m0-8Q13 8.425 13 8t-.288-.712T12 7t-.712.288T11 8t.288.713T12 9t.713-.288M12 22q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22'
}
const CLOSE = 'm12 13.4l-4.9 4.9q-.275.275-.7.275t-.7-.275t-.275-.7t.275-.7l4.9-4.9l-4.9-4.9q-.275-.275-.275-.7t.275-.7t.7-.275t.7.275l4.9 4.9l4.9-4.9q.275-.275.7-.275t.7.275t.275.7t-.275.7L13.4 12l4.9 4.9q.275.275.275.7t-.275.7t-.7.275t-.7-.275z'

const root = document.querySelector<HTMLElement>('#toast-overlay-root')
if (!root) throw new Error('Toast overlay root is unavailable')
const overlayRoot = root
const api = window.hronautToastOverlayView

let currentId = 0
let currentRevision = 0
let reported = ''

function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const shape = document.createElementNS(SVG, 'path')
  shape.setAttribute('fill', 'currentColor')
  shape.setAttribute('d', path)
  svg.append(shape)
  return svg
}

function button(className: string, focused: boolean, onClick: () => void): HTMLButtonElement {
  const control = document.createElement('button')
  control.type = 'button'
  control.className = className
  // Only the shell's copy of the toast takes keyboard focus; this one shows where that focus is.
  control.tabIndex = -1
  if (focused) control.dataset.focused = 'true'
  // A press does not move focus into the view; main hands it back to the page or the shell anyway.
  control.addEventListener('mousedown', (event) => event.preventDefault())
  control.addEventListener('click', onClick)
  return control
}

function send(kind: ToastOverlayMessage['kind']): void {
  if (currentId) api.send({ id: currentId, kind })
}

function measure(revision: number): void {
  if (revision !== currentRevision) return
  // Reading the box performs layout while the view is still hidden; a hidden view may never produce a frame.
  // The root's box, not the toast's: a new toast grows in with a scale, and its own box is the scaled one, which would
  // leave the view short of the toast's bottom edge.
  const height = Math.ceil(overlayRoot.getBoundingClientRect().height)
  const key = `${revision}:${height}`
  if (key === reported || height < 1) return
  reported = key
  api.measured({ revision, height })
}

function render(state: ToastOverlayState): void {
  const opening = state.toast.id !== currentId
  currentId = state.toast.id
  currentRevision = state.revision
  document.documentElement.dataset.theme = state.theme
  overlayRoot.style.width = `${state.width}px`

  const { toast, focus } = state
  const element = document.createElement('div')
  element.className = `toast-overlay ${toast.tone}`
  if (toast.action) element.classList.add('with-action')
  if (opening) element.dataset.opening = 'true'
  element.title = toast.message ? `${toast.title}: ${toast.message}` : toast.title

  const mark = document.createElement('span')
  mark.className = 'toast-overlay-mark'
  mark.append(icon(MARKS[toast.tone]))
  const copy = document.createElement('span')
  copy.className = 'toast-overlay-copy'
  const title = document.createElement('strong')
  title.textContent = toast.title
  const message = document.createElement('span')
  message.textContent = toast.message
  copy.append(title, message)
  element.append(mark, copy)

  if (toast.action) {
    const action = button('toast-overlay-action', focus === 'action', () => send('act'))
    action.textContent = toast.action.label
    element.append(action)
    // Holding the pointer on a toast with an action keeps it until the pointer leaves.
    element.addEventListener('pointerenter', () => send('retain'))
    element.addEventListener('pointerleave', () => send('release'))
  }
  const dismiss = button('toast-overlay-dismiss', focus === 'dismiss', () => send('dismiss'))
  dismiss.append(icon(CLOSE))
  element.append(dismiss)

  overlayRoot.replaceChildren(element)
  measure(state.revision)
  // The first toast can lay out before the bundled font has loaded; report its final size too.
  void document.fonts?.ready.then(() => measure(state.revision))
}

api.onState(render)

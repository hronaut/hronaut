import './startup-notice.css'
import { isResolvedThemeName } from '../../shared/theme.js'

/**
 * A notice Hronaut shows in a window of its own when startup stops before the main window can show anything, such as
 * when saved workspaces cannot be opened. Main passes the text, already in the interface language, and the theme in
 * the address; closing the window quits Hronaut.
 */
const parameters = new URLSearchParams(location.search)
const theme = parameters.get('theme')
document.documentElement.dataset.theme = isResolvedThemeName(theme) ? theme : 'dark'
document.documentElement.lang = parameters.get('lang') ?? 'en'
document.title = parameters.get('title') ?? 'Hronaut'

function fill(id: string, text: string | null): HTMLElement {
  const element = document.getElementById(id)
  if (!element) throw new Error(`The startup notice lacks #${id}`)
  element.textContent = text ?? ''
  return element
}

fill('startup-notice-title', parameters.get('title'))
fill('startup-notice-message', parameters.get('message'))
fill('startup-notice-detail', parameters.get('detail'))
const quit = fill('startup-notice-quit', parameters.get('quit'))
const notice = document.querySelector<HTMLElement>('.startup-notice')

/**
 * The keyboard can quit only once the window has had the focus for a moment, as in Hronaut's dialogs. A key held since
 * before the window appeared, such as Enter from the launcher, repeats, and on Windows and Linux its first repeat here
 * does not say so; it never quits unread.
 */
const ARM_DELAY_MS = 500
let armed = false
let arming: ReturnType<typeof setTimeout> | undefined
function arm(): void {
  armed = false
  if (notice) notice.dataset.armed = 'false'
  clearTimeout(arming)
  arming = setTimeout(() => {
    armed = true
    if (notice) notice.dataset.armed = 'true'
  }, ARM_DELAY_MS)
}
arm()
window.addEventListener('focus', arm)

quit.addEventListener('click', (event) => {
  // A click from the keyboard has no pointer detail.
  if (!armed && event.detail === 0) return
  window.close()
})
document.addEventListener('keydown', (event) => {
  if (event.repeat || (!armed && ['Enter', ' ', 'Escape'].includes(event.key))) {
    event.preventDefault()
    return
  }
  if (event.key === 'Escape') window.close()
}, true)
quit.focus()

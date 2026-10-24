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
quit.addEventListener('click', () => window.close())

document.addEventListener('keydown', (event) => {
  // A key held since before the window appeared, such as Enter from the launcher, repeats; it never quits unread.
  if (event.repeat) {
    event.preventDefault()
    return
  }
  if (event.key === 'Escape') window.close()
}, true)
quit.focus()

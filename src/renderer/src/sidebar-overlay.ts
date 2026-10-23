import { createApp } from 'vue'
import './styles.css'
import './sidebar-overlay.css'
import type { HronautSidebarOverlayViewApi } from '../../shared/sidebar-overlay.js'
import SidebarOverlayView from './components/SidebarOverlayView.vue'
import { createHronautI18n } from './i18n.js'

declare global {
  interface Window {
    hronautSidebarOverlayView: HronautSidebarOverlayViewApi
  }
}

// The tab rail opened over the page: the shell's own rail components, drawn from what the shell sends through main.
const root = document.querySelector<HTMLElement>('#sidebar-overlay-root')
if (!root) throw new Error('Sidebar overlay root is unavailable')
createApp(SidebarOverlayView, { api: window.hronautSidebarOverlayView })
  .use(createHronautI18n('en-US'))
  .mount(root)

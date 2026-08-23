import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles.css'
import { createHronautI18n } from './i18n.js'
import { useSettingsStore } from './stores/settings.js'
import { renderStartupFailure } from './startup-failure.js'

async function startRenderer(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#app') ?? document.body
  try {
    const initialSettingsState = await window.hronautSettings.getRendererState()
    const pinia = createPinia()
    const settingsStore = useSettingsStore(pinia)
    settingsStore.hydrate(initialSettingsState)
    const i18n = createHronautI18n(initialSettingsState.resolvedLocale)

    function applyDocumentLocale(locale: import('../../shared/locale.js').SupportedLocale): void {
      document.documentElement.lang = locale
      document.documentElement.dir = 'ltr'
      i18n.global.locale.value = locale
    }

    applyDocumentLocale(initialSettingsState.resolvedLocale)
    watch(() => settingsStore.resolvedLocale, applyDocumentLocale)

    const app = createApp(App)
    app.use(pinia)
    app.use(i18n)
    app.mount(root)
  } catch (error) {
    renderStartupFailure(root, error)
  }
}

void startRenderer()

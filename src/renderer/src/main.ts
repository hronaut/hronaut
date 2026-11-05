import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles.css'
import { createHronautI18n, createLocaleSwitch } from './i18n.js'
import { loadLocaleMessages } from './locale-messages.js'
import { useSettingsStore } from './stores/settings.js'
import { renderStartupFailure } from './startup-failure.js'
import type { SupportedLocale } from '../../shared/locale.js'

function applyDocumentLocale(locale: SupportedLocale): void {
  document.documentElement.lang = locale
  document.documentElement.dir = 'ltr'
}

async function startRenderer(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#app') ?? document.body
  try {
    const initialSettingsState = await window.hronautSettings.getRendererState()
    const pinia = createPinia()
    const settingsStore = useSettingsStore(pinia)
    settingsStore.hydrate(initialSettingsState)
    // The shell draws first in the chosen language, never in English before it.
    const locale = (await loadLocaleMessages(initialSettingsState.resolvedLocale)) ? initialSettingsState.resolvedLocale : 'en-US'
    const i18n = createHronautI18n(locale)
    const switchLocale = createLocaleSwitch(i18n.global)
    applyDocumentLocale(locale)
    watch(() => settingsStore.resolvedLocale, async (next) => {
      const shown = await switchLocale(next)
      if (shown) applyDocumentLocale(shown)
    })

    const app = createApp(App)
    app.use(pinia)
    app.use(i18n)
    app.mount(root)
  } catch (error) {
    await renderStartupFailure(root, error)
  }
}

void startRenderer()

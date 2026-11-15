import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach } from 'vitest'
import { loadLocaleMessages } from '../../src/renderer/src/locale-messages.js'
import { SUPPORTED_LOCALES } from '../../src/shared/locale.js'

// A window loads the language it shows before drawing in it; components here are drawn in any language at once.
await Promise.all(SUPPORTED_LOCALES.map(loadLocaleMessages))

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  cleanup()
})

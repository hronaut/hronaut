import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach } from 'vitest'

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  cleanup()
})

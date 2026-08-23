import { ref } from 'vue'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SearchSettingsPanel from '../../src/renderer/src/components/SearchSettingsPanel.vue'
import { useSearchSettingsController } from '../../src/renderer/src/composables/useSearchSettingsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import type { AppSettings } from '../../src/shared/types.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => { resolve = next })
  return { promise, resolve }
}

function renderPanel() {
  const settings = ref<AppSettings>({ ...DEFAULT_RENDERER_SETTINGS })
  const setSearchEngine = vi.fn(async (searchEngine: AppSettings['searchEngine']) => {
    settings.value = { ...settings.value, searchEngine }
    return settings.value
  })
  const controller = useSearchSettingsController({ settings, setSearchEngine, onError: vi.fn() })
  render(SearchSettingsPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: { controller }
  })
  return { controller, setSearchEngine, settings }
}

describe('SearchSettingsPanel', () => {
  it('renders all engines as an accessible single-choice group', async () => {
    const { controller, setSearchEngine } = renderPanel()

    expect(screen.getByRole('radiogroup', { name: 'Default search engine' })).toBeVisible()
    expect(screen.getAllByRole('radio')).toHaveLength(5)
    expect(screen.getByTestId('search-engine-google')).toHaveAttribute('aria-checked', 'true')
    await userEvent.setup().click(screen.getByTestId('search-engine-duckduckgo'))

    expect(setSearchEngine).toHaveBeenCalledWith('duckduckgo')
    expect(screen.getByTestId('search-engine-duckduckgo')).toHaveAttribute('aria-checked', 'true')
    controller.dispose()
  })

  it('disables every engine while a selection is being saved', async () => {
    const saving = deferred<AppSettings>()
    const { controller, setSearchEngine } = renderPanel()
    setSearchEngine.mockImplementationOnce(() => saving.promise)

    await userEvent.setup().click(screen.getByTestId('search-engine-brave'))

    for (const option of screen.getAllByRole('radio')) expect(option).toBeDisabled()
    saving.resolve({ ...DEFAULT_RENDERER_SETTINGS, searchEngine: 'brave' })
    await vi.waitFor(() => expect(controller.busy.value).toBe(false))
    controller.dispose()
  })
})

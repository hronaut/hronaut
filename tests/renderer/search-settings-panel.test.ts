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

  it.each([
    ['ArrowRight', 'duckduckgo'],
    ['ArrowDown', 'duckduckgo'],
    ['ArrowLeft', 'startpage'],
    ['ArrowUp', 'startpage'],
    ['End', 'startpage']
  ])('selects and focuses the next engine with %s', async (key, engine) => {
    const { controller, setSearchEngine } = renderPanel()
    const google = screen.getByTestId('search-engine-google')
    expect(google).toHaveAttribute('tabindex', '0')
    for (const option of screen.getAllByRole('radio').filter(option => option !== google)) {
      expect(option).toHaveAttribute('tabindex', '-1')
    }
    google.focus()
    await userEvent.setup().keyboard(`{${key}}`)
    const selected = screen.getByTestId(`search-engine-${engine}`)
    expect(selected).toHaveFocus()
    expect(selected).toHaveAttribute('aria-checked', 'true')
    expect(selected).toHaveAttribute('tabindex', '0')
    expect(google).toHaveAttribute('tabindex', '-1')
    expect(setSearchEngine).toHaveBeenCalledWith(engine)
    await userEvent.setup().keyboard('{Home}')
    expect(google).toHaveFocus()
    expect(google).toHaveAttribute('aria-checked', 'true')
    controller.dispose()
  })

  it('preserves focus and blocks another selection while a selection is being saved', async () => {
    const saving = deferred<AppSettings>()
    const { controller, setSearchEngine } = renderPanel()
    setSearchEngine.mockImplementationOnce(() => saving.promise)

    await userEvent.setup().click(screen.getByTestId('search-engine-brave'))

    for (const option of screen.getAllByRole('radio')) expect(option).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('search-engine-brave')).toHaveFocus()
    await userEvent.setup().keyboard('{ArrowRight}')
    expect(screen.getByTestId('search-engine-brave')).toHaveFocus()
    await userEvent.setup().click(screen.getByTestId('search-engine-google'))
    expect(setSearchEngine).toHaveBeenCalledTimes(1)
    saving.resolve({ ...DEFAULT_RENDERER_SETTINGS, searchEngine: 'brave' })
    await vi.waitFor(() => expect(controller.busy.value).toBe(false))
    controller.dispose()
  })
})

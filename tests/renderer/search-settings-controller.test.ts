import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useSearchSettingsController } from '../../src/renderer/src/composables/useSearchSettingsController.js'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import type { AppSettings } from '../../src/shared/types.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => { resolve = next })
  return { promise, resolve }
}

function createController() {
  const settings = ref<AppSettings>({ ...DEFAULT_RENDERER_SETTINGS })
  const setSearchEngine = vi.fn(async (searchEngine: AppSettings['searchEngine']) => {
    settings.value = { ...settings.value, searchEngine }
    return settings.value
  })
  const onError = vi.fn()
  const controller = useSearchSettingsController({ settings, setSearchEngine, onError })
  return { controller, onError, setSearchEngine, settings }
}

describe('search settings controller', () => {
  it('selects and resets the authoritative search engine', async () => {
    const { controller, setSearchEngine, settings } = createController()

    await expect(controller.select('duckduckgo')).resolves.toBe(true)
    await expect(controller.reset()).resolves.toBe(true)

    expect(setSearchEngine).toHaveBeenNthCalledWith(1, 'duckduckgo')
    expect(setSearchEngine).toHaveBeenNthCalledWith(2, 'google')
    expect(settings.value.searchEngine).toBe('google')
    controller.dispose()
  })

  it('blocks overlapping selections until the active save settles', async () => {
    const saving = deferred<AppSettings>()
    const { controller, setSearchEngine } = createController()
    setSearchEngine.mockImplementationOnce(() => saving.promise)

    const first = controller.select('duckduckgo')
    await expect(controller.select('brave')).resolves.toBe(false)

    expect(setSearchEngine).toHaveBeenCalledOnce()
    expect(controller.busy.value).toBe(true)
    saving.resolve({ ...DEFAULT_RENDERER_SETTINGS, searchEngine: 'duckduckgo' })
    await expect(first).resolves.toBe(true)
    expect(controller.busy.value).toBe(false)
    controller.dispose()
  })

  it('reports persistence failures and becomes usable again', async () => {
    const failure = new Error('settings unavailable')
    const { controller, onError, setSearchEngine } = createController()
    setSearchEngine.mockRejectedValueOnce(failure)

    await expect(controller.select('brave')).resolves.toBe(false)

    expect(onError).toHaveBeenCalledWith(failure)
    expect(controller.busy.value).toBe(false)
    await expect(controller.select('startpage')).resolves.toBe(true)
    controller.dispose()
  })
})

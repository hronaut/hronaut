import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useMcpSettingsController } from '../../src/renderer/src/composables/useMcpSettingsController.js'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import type { AppSettings } from '../../src/shared/types.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function createController() {
  const settings = ref<AppSettings>({ ...DEFAULT_RENDERER_SETTINGS })
  const endpoint = ref('http://127.0.0.1:47812/mcp')
  const listenerFailed = ref(false)
  const setAuthentication = vi.fn(async (enabled: boolean) => {
    settings.value = { ...settings.value, mcpAuthentication: enabled }
    return settings.value
  })
  const setPort = vi.fn(async (port: number) => {
    settings.value = { ...settings.value, mcpPort: port }
    return settings.value
  })
  const setToolSet = vi.fn(async (mcpToolSet: AppSettings['mcpToolSet']) => {
    settings.value = { ...settings.value, mcpToolSet }
    return settings.value
  })
  const resetSettings = vi.fn(async () => {
    settings.value = {
      ...settings.value,
      mcpAuthentication: false,
      mcpPort: DEFAULT_RENDERER_SETTINGS.mcpPort,
      mcpToolSet: DEFAULT_RENDERER_SETTINGS.mcpToolSet
    }
    return settings.value
  })
  const confirmDisableAuthentication = vi.fn(() => true)
  const onAuthenticationError = vi.fn()
  const controller = useMcpSettingsController({
    settings,
    endpoint,
    listenerFailed,
    setAuthentication,
    setPort,
    setToolSet,
    resetSettings,
    confirmDisableAuthentication,
    translate: (key, parameters) => `${key}:${JSON.stringify(parameters ?? {})}`,
    formatPortError: (error) => error instanceof Error ? error.message : String(error),
    onAuthenticationError
  })
  return {
    controller,
    confirmDisableAuthentication,
    listenerFailed,
    onAuthenticationError,
    setAuthentication,
    setPort,
    setToolSet,
    resetSettings,
    settings
  }
}

describe('MCP settings controller', () => {
  it('preserves a newer draft when the listener move for an older draft completes', async () => {
    const saving = deferred<AppSettings>()
    const { controller, setPort, settings } = createController()
    setPort.mockImplementationOnce(async () => {
      const next = await saving.promise
      settings.value = next
      return next
    })

    controller.editPort('49000')
    const move = controller.applyPort()
    expect(controller.portState.value).toBe('saving')
    controller.editPort('49001')

    saving.resolve({ ...DEFAULT_RENDERER_SETTINGS, mcpPort: 49000 })
    await expect(move).resolves.toBe(true)

    expect(controller.portDraft.value).toBe('49001')
    expect(controller.portState.value).toBe('idle')
    expect(controller.portMessage.value).toBe('')
    expect(controller.canApplyPort.value).toBe(true)
    controller.dispose()
  })

  it('does not erase a dirty port draft when another setting changes', async () => {
    const { controller, settings } = createController()
    controller.editPort('49000')

    settings.value = { ...settings.value, theme: 'dark' }
    await nextTick()

    expect(controller.portDraft.value).toBe('49000')
    controller.dispose()
  })

  it('tracks an authoritative listener move while the draft is clean', async () => {
    const { controller, settings } = createController()

    settings.value = { ...settings.value, mcpPort: 49000 }
    await nextTick()

    expect(controller.portDraft.value).toBe('49000')
    controller.dispose()
  })

  it('does not restart a healthy listener when the unchanged port is submitted', async () => {
    const { controller, setPort } = createController()

    await expect(controller.applyPort()).resolves.toBe(false)

    expect(setPort).not.toHaveBeenCalled()
    expect(controller.portState.value).toBe('idle')
    controller.dispose()
  })

  it('retries the current port when the listener is unhealthy', async () => {
    const { controller, listenerFailed, setPort } = createController()
    listenerFailed.value = true

    await expect(controller.applyPort()).resolves.toBe(true)

    expect(setPort).toHaveBeenCalledWith(DEFAULT_RENDERER_SETTINGS.mcpPort)
    controller.dispose()
  })

  it('blocks authentication mutations while a port move is in flight', async () => {
    const saving = deferred<AppSettings>()
    const { controller, setAuthentication, setPort } = createController()
    setPort.mockImplementationOnce(() => saving.promise)
    controller.editPort('49000')

    const move = controller.applyPort()
    await expect(controller.setAuthentication(true)).resolves.toBe(false)

    expect(setAuthentication).not.toHaveBeenCalled()
    saving.resolve({ ...DEFAULT_RENDERER_SETTINGS, mcpPort: 49000 })
    await expect(move).resolves.toBe(true)
    controller.dispose()
  })

  it('serializes a server-wide tool-set change with other MCP settings operations', async () => {
    const saving = deferred<AppSettings>()
    const { controller, setPort, setToolSet } = createController()
    setPort.mockImplementationOnce(() => saving.promise)
    controller.editPort('49000')

    const move = controller.applyPort()
    await expect(controller.setToolSet('qa')).resolves.toBe(false)
    expect(setToolSet).not.toHaveBeenCalled()

    saving.resolve({ ...DEFAULT_RENDERER_SETTINGS, mcpPort: 49000 })
    await expect(move).resolves.toBe(true)
    await expect(controller.setToolSet('qa')).resolves.toBe(true)
    expect(setToolSet).toHaveBeenCalledWith('qa')
    controller.dispose()
  })

  it('keeps the authoritative port and exposes listener relocation errors', async () => {
    const { controller, setPort, settings } = createController()
    setPort.mockRejectedValueOnce(new Error('port already in use'))
    controller.editPort('49000')

    await expect(controller.applyPort()).resolves.toBe(false)

    expect(settings.value.mcpPort).toBe(DEFAULT_RENDERER_SETTINGS.mcpPort)
    expect(controller.portDraft.value).toBe('49000')
    expect(controller.portState.value).toBe('error')
    expect(controller.portMessage.value).toBe('port already in use')
    controller.dispose()
  })

  it('reports an atomic reset failure without invoking either individual setting mutation', async () => {
    const { controller, onAuthenticationError, resetSettings, setAuthentication, setPort } = createController()
    resetSettings.mockRejectedValueOnce(new Error('settings unavailable'))

    await expect(controller.reset()).resolves.toBe(false)

    expect(resetSettings).toHaveBeenCalledOnce()
    expect(setAuthentication).not.toHaveBeenCalled()
    expect(setPort).not.toHaveBeenCalled()
    expect(onAuthenticationError).not.toHaveBeenCalled()
    expect(controller.portState.value).toBe('error')
    expect(controller.portMessage.value).toBe('settings unavailable')
    controller.dispose()
  })

  it('does not partially disable authentication when restoring the default port fails', async () => {
    const { controller, resetSettings, setAuthentication, setPort, settings } = createController()
    settings.value = {
      ...settings.value,
      mcpAuthentication: true,
      mcpPort: 49_000
    }
    resetSettings.mockRejectedValueOnce(new Error('default port already in use'))

    await expect(controller.reset()).resolves.toBe(false)

    expect(settings.value).toMatchObject({
      mcpAuthentication: true,
      mcpPort: 49_000
    })
    expect(setAuthentication).not.toHaveBeenCalled()
    expect(setPort).not.toHaveBeenCalled()
    controller.dispose()
  })
})

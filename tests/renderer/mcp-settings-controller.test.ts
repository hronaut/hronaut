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
  const confirmDisableAuthentication = vi.fn(() => true)
  const onAuthenticationError = vi.fn()
  const controller = useMcpSettingsController({
    settings,
    endpoint,
    listenerFailed,
    setAuthentication,
    setPort,
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

  it('stops reset when authentication persistence fails', async () => {
    const { controller, onAuthenticationError, setAuthentication, setPort } = createController()
    setAuthentication.mockRejectedValueOnce(new Error('settings unavailable'))

    await expect(controller.reset()).resolves.toBe(false)

    expect(setPort).not.toHaveBeenCalled()
    expect(onAuthenticationError).toHaveBeenCalledWith(expect.any(Error))
    controller.dispose()
  })
})

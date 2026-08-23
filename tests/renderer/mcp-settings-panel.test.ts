import { ref } from 'vue'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import McpSettingsPanel from '../../src/renderer/src/components/McpSettingsPanel.vue'
import { useMcpSettingsController } from '../../src/renderer/src/composables/useMcpSettingsController.js'
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
  const endpoint = ref('http://127.0.0.1:47812/mcp')
  const setAuthentication = vi.fn(async (enabled: boolean) => {
    settings.value = { ...settings.value, mcpAuthentication: enabled }
    return settings.value
  })
  const setPort = vi.fn(async (port: number) => {
    settings.value = { ...settings.value, mcpPort: port }
    return settings.value
  })
  const confirmDisableAuthentication = vi.fn(() => true)
  const controller = useMcpSettingsController({
    settings,
    endpoint,
    listenerFailed: ref(false),
    setAuthentication,
    setPort,
    confirmDisableAuthentication,
    translate: (key, parameters) => createHronautI18n('en-US').global.t(key, parameters ?? {}),
    formatPortError: (error) => error instanceof Error ? error.message : String(error),
    onAuthenticationError: vi.fn()
  })
  render(McpSettingsPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: { controller }
  })
  return { controller, confirmDisableAuthentication, setAuthentication, setPort, settings }
}

describe('McpSettingsPanel', () => {
  it('renders the active endpoint and security warning', () => {
    const { controller } = renderPanel()

    expect(screen.getByRole('heading', { name: 'MCP security' })).toBeVisible()
    expect(screen.getByRole('spinbutton', { name: 'MCP server port' })).toHaveValue(47812)
    expect(screen.getByText('Active endpoint: http://127.0.0.1:47812/mcp')).toBeVisible()
    expect(screen.getByText(/^Authentication is off\./)).toBeVisible()
    controller.dispose()
  })

  it('preserves a port typed while an earlier listener move is pending', async () => {
    const saving = deferred<AppSettings>()
    const { controller, setPort, settings } = renderPanel()
    setPort.mockImplementationOnce(async () => {
      const next = await saving.promise
      settings.value = next
      return next
    })
    const user = userEvent.setup()
    const port = screen.getByRole('spinbutton', { name: 'MCP server port' })

    await user.clear(port)
    await user.type(port, '49000')
    await user.click(screen.getByRole('button', { name: 'Apply port' }))
    expect(screen.getByRole('checkbox', { name: /^Require MCP authentication/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Moving…' })).toBeDisabled()

    await user.clear(port)
    await user.type(port, '49001')
    saving.resolve({ ...DEFAULT_RENDERER_SETTINGS, mcpPort: 49000 })
    await vi.waitFor(() => expect(controller.busy.value).toBe(false))

    expect(port).toHaveValue(49001)
    expect(screen.queryByText('MCP port 49000 is active.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply port' })).toBeEnabled()
    controller.dispose()
  })

  it('restores the authentication checkbox when disabling is cancelled', async () => {
    const { controller, confirmDisableAuthentication, setAuthentication, settings } = renderPanel()
    settings.value = { ...settings.value, mcpAuthentication: true }
    confirmDisableAuthentication.mockReturnValueOnce(false)
    const user = userEvent.setup()
    const authentication = screen.getByRole('checkbox', { name: /^Require MCP authentication/ })

    await user.click(authentication)

    expect(authentication).toBeChecked()
    expect(setAuthentication).not.toHaveBeenCalled()
    controller.dispose()
  })
})

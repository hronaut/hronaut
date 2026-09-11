import { ref } from 'vue'
import { fireEvent, render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import McpSettingsPanel from '../../src/renderer/src/components/McpSettingsPanel.vue'
import { useMcpSettingsController } from '../../src/renderer/src/composables/useMcpSettingsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import type { AppSettings, McpCapabilityProfileSummary } from '../../src/shared/types.js'

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
  const listCapabilityProfiles = vi.fn(async (): Promise<McpCapabilityProfileSummary[]> => [])
  const createCapabilityProfile = vi.fn(async () => ({
    profile: {
      id: '01912345-6789-7abc-8def-0123456789ab', name: 'QA reader', revision: 1,
      credentialId: '11111111-1111-4111-8111-111111111111', allowedTools: ['browser_snapshot'],
      operationClasses: ['read'], useCount: 0,
      createdAt: '2026-09-11T12:00:00.000Z', updatedAt: '2026-09-11T12:00:00.000Z'
    },
    credential: `hrc1_${'a'.repeat(43)}`
  }))
  const controller = useMcpSettingsController({
    settings,
    endpoint,
    listenerFailed: ref(false),
    setAuthentication,
    setToolSet,
    setPort,
    resetSettings,
    listCapabilityProfiles,
    createCapabilityProfile,
    rotateCapabilityProfile: vi.fn(),
    revokeCapabilityProfile: vi.fn(),
    confirmDisableAuthentication,
    translate: (key, parameters) => createHronautI18n('en-US').global.t(key, parameters ?? {}),
    formatPortError: (error) => error instanceof Error ? error.message : String(error),
    onAuthenticationError: vi.fn()
  })
  render(McpSettingsPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: { controller }
  })
  return { controller, confirmDisableAuthentication, createCapabilityProfile, setAuthentication, setPort, setToolSet, settings }
}

describe('McpSettingsPanel', () => {
  it('renders the active endpoint and security warning', () => {
    const { controller } = renderPanel()

    expect(screen.getByRole('heading', { name: 'MCP security' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'MCP tool set' })).toHaveValue('essentials')
    expect(screen.getByRole('spinbutton', { name: 'MCP server port' })).toHaveValue(47812)
    expect(screen.getByText('Active endpoint: http://127.0.0.1:47812/mcp')).toBeVisible()
    expect(screen.getByText(/^Authentication is off\./)).toBeVisible()
    controller.dispose()
  })

  it('changes the server-wide tool set and explains client reconnection', async () => {
    const { controller, setToolSet } = renderPanel()
    const user = userEvent.setup()

    await user.selectOptions(screen.getByRole('combobox', { name: 'MCP tool set' }), 'qa')

    expect(setToolSet).toHaveBeenCalledWith('qa')
    expect(screen.getByRole('combobox', { name: 'MCP tool set' })).toHaveValue('qa')
    expect(screen.getByText(/Connected MCP clients keep their current catalog.*Reconnect them to apply this change/i)).toBeVisible()
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

  it('does not apply the port when Enter confirms an IME composition', async () => {
    const { controller, setPort } = renderPanel()
    const port = screen.getByRole('spinbutton', { name: 'MCP server port' })
    await fireEvent.update(port, '49000')

    await fireEvent.keyDown(port, { key: 'Enter', isComposing: true })

    expect(setPort).not.toHaveBeenCalled()
    expect(port).toHaveValue(49000)
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

  it('creates a scoped profile and shows its credential only in the transient result', async () => {
    const { controller, createCapabilityProfile } = renderPanel()
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Profile name'), 'QA reader')
    await user.type(screen.getByLabelText('Workspace IDs (optional)'), '01912345-6789-7abc-8def-0123456789ab')
    await user.type(screen.getByLabelText('Website origins (optional)'), 'https://allowed.example/path')
    await user.click(screen.getByRole('button', { name: 'Create profile' }))

    expect(createCapabilityProfile).toHaveBeenCalledWith({
      name: 'QA reader', preset: 'read-only',
      workspaceIds: ['01912345-6789-7abc-8def-0123456789ab'],
      origins: ['https://allowed.example/path'], expiresInMinutes: 1440, singleUse: false
    })
    expect(screen.getByText(`hrc1_${'a'.repeat(43)}`)).toBeVisible()
    expect(screen.getByText('QA reader')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(`hrc1_${'a'.repeat(43)}`)).not.toBeInTheDocument()
    controller.dispose()
  })
})

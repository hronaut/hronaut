import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useMcpSettingsController } from '../../src/renderer/src/composables/useMcpSettingsController.js'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import type { AppSettings, McpCapabilityCredentialResult, McpCapabilityProfileSummary } from '../../src/shared/types.js'

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
  const setRemoteAccess = vi.fn(async (enabled: boolean) => (
    settings.value = { ...settings.value, mcpRemoteAccess: enabled }
  ))
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
      mcpRemoteAccess: false,
      mcpAuthentication: false,
      mcpPort: DEFAULT_RENDERER_SETTINGS.mcpPort,
      mcpToolSet: DEFAULT_RENDERER_SETTINGS.mcpToolSet
    }
    return settings.value
  })
  const confirmDisableAuthentication = vi.fn(() => true)
  const onAuthenticationError = vi.fn()
  const createCapabilityProfile = vi.fn()
  const listCapabilityProfiles = vi.fn(async (): Promise<McpCapabilityProfileSummary[]> => [])
  const rotateCapabilityProfile = vi.fn()
  const revokeCapabilityProfile = vi.fn()
  const controller = useMcpSettingsController({
    settings,
    endpoint,
    listenerFailed,
    setRemoteAccess,
    setAuthentication,
    setPort,
    setToolSet,
    resetSettings,
    listCapabilityProfiles,
    createCapabilityProfile,
    rotateCapabilityProfile,
    revokeCapabilityProfile,
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
    createCapabilityProfile,
    listCapabilityProfiles,
    rotateCapabilityProfile,
    revokeCapabilityProfile,
    setRemoteAccess,
    setAuthentication,
    setPort,
    setToolSet,
    resetSettings,
    settings
  }
}

describe('MCP settings controller', () => {
  it.each(['move', 'reset'] as const)('keeps newer authoritative port events after a delayed %s response', async action => {
    const { controller, settings, setPort, resetSettings } = createController()
    const pending = deferred<AppSettings>()
    setPort.mockImplementationOnce(() => pending.promise)
    resetSettings.mockImplementationOnce(() => pending.promise)
    controller.editPort('49000')
    const operation = action === 'move' ? controller.applyPort() : controller.reset()
    settings.value = { ...settings.value, mcpPort: 49002 }
    await nextTick()
    pending.resolve({ ...DEFAULT_RENDERER_SETTINGS, mcpPort: action === 'move' ? 49000 : DEFAULT_RENDERER_SETTINGS.mcpPort })

    await expect(operation).resolves.toBe(true)
    expect(controller.portDraft.value).toBe('49002')
    expect(controller.portMessage.value).toBe('runtimeActions.mcp.active:{"port":49002}')
    expect(controller.canApplyPort.value).toBe(false)
    controller.dispose()
  })

  it('keeps remote-access failures visible and serializes the pending setting change', async () => {
    const { controller, setRemoteAccess, setPort, onAuthenticationError } = createController()
    const pending = deferred<AppSettings>()
    setRemoteAccess.mockReturnValueOnce(pending.promise)
    const operation = controller.setRemoteAccess(true)
    controller.editPort('49000')
    await expect(controller.applyPort()).resolves.toBe(false)
    expect(setPort).not.toHaveBeenCalled()
    pending.reject(new Error('Settings could not be saved'))
    await expect(operation).resolves.toBe(false)
    expect(onAuthenticationError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Settings could not be saved' }))
    expect(controller.busy.value).toBe(false)
    controller.dispose()
  })

  it('marks every cached descendant inactive when a parent credential rotates', async () => {
    const { controller, listCapabilityProfiles, rotateCapabilityProfile } = createController()
    const parent: McpCapabilityProfileSummary = {
      id: '01912345-6788-7abc-8def-0123456789ab', name: 'Parent', revision: 1,
      credentialId: '11111111-1111-4111-8111-111111111111', allowedTools: ['browser_snapshot'],
      operationClasses: ['read'], useCount: 0, lineageActive: true,
      createdAt: '2026-09-11T12:00:00.000Z', updatedAt: '2026-09-11T12:00:00.000Z'
    }
    const child: McpCapabilityProfileSummary = {
      ...parent,
      id: '01912345-6789-7abc-8def-0123456789ab', name: 'Child',
      credentialId: '22222222-2222-4222-8222-222222222222',
      parentAuthorization: { profileId: parent.id, revision: 1, credentialId: parent.credentialId }
    }
    const grandchild: McpCapabilityProfileSummary = {
      ...child,
      id: '01912345-678a-7abc-8def-0123456789ab', name: 'Grandchild',
      credentialId: '33333333-3333-4333-8333-333333333333',
      parentAuthorization: { profileId: child.id, revision: 1, credentialId: child.credentialId }
    }
    listCapabilityProfiles.mockResolvedValueOnce([parent, child, grandchild])
    await controller.loadCapabilityProfiles()
    rotateCapabilityProfile.mockResolvedValueOnce({
      profile: { ...parent, revision: 2, credentialId: '44444444-4444-4444-8444-444444444444' },
      credential: `hrc1_${'c'.repeat(43)}`
    })

    await expect(controller.rotateCapabilityProfile(parent.id)).resolves.toBe(true)

    expect(controller.capabilityProfiles.value.map(profile => [profile.name, profile.lineageActive])).toEqual([
      ['Parent', true], ['Child', false], ['Grandchild', false]
    ])
    expect(controller.capabilityCredential.value).toBe(`hrc1_${'c'.repeat(43)}`)
    controller.dispose()
  })

  it.each(['create', 'rotate', 'revoke'] as const)(
    'keeps a completed credential %s authoritative over an older profile list',
    async (action) => {
      const { controller, listCapabilityProfiles, createCapabilityProfile, rotateCapabilityProfile, revokeCapabilityProfile } = createController()
      const profile: McpCapabilityProfileSummary = {
        id: '01912345-6788-7abc-8def-0123456789ab', name: 'Agent', revision: 1,
        credentialId: '11111111-1111-4111-8111-111111111111', allowedTools: ['browser_snapshot'],
        operationClasses: ['read'], useCount: 0, lineageActive: true,
        createdAt: '2026-09-11T12:00:00.000Z', updatedAt: '2026-09-11T12:00:00.000Z'
      }
      const before = action === 'create' ? [] : [profile]
      controller.capabilityProfiles.value = before
      const pending = deferred<McpCapabilityProfileSummary[]>()
      listCapabilityProfiles.mockReturnValueOnce(pending.promise)
      const loading = controller.loadCapabilityProfiles()
      const changed = { ...profile, revision: 2, lineageActive: action !== 'revoke' }
      createCapabilityProfile.mockResolvedValue({ profile: changed, credential: 'test-credential' })
      rotateCapabilityProfile.mockResolvedValue({ profile: changed, credential: 'test-credential' })
      revokeCapabilityProfile.mockResolvedValue(changed)
      if (action === 'create') await controller.createCapabilityProfile({ name: 'Agent', preset: 'read-only' })
      else if (action === 'rotate') await controller.rotateCapabilityProfile(profile.id)
      else await controller.revokeCapabilityProfile(profile.id)

      pending.resolve(before)
      await expect(loading).resolves.toBe(false)
      expect(controller.capabilityProfiles.value).toEqual([changed])
      controller.dispose()
    }
  )

  it('keeps one profile when a refresh observes creation before the create response arrives', async () => {
    const { controller, listCapabilityProfiles, createCapabilityProfile } = createController()
    const profile: McpCapabilityProfileSummary = {
      id: '01912345-6788-7abc-8def-0123456789ab', name: 'Agent', revision: 1,
      credentialId: '11111111-1111-4111-8111-111111111111', allowedTools: ['browser_snapshot'],
      operationClasses: ['read'], useCount: 0, lineageActive: true,
      createdAt: '2026-09-11T12:00:00.000Z', updatedAt: '2026-09-11T12:00:00.000Z'
    }
    const existing = { ...profile, id: '01912345-6789-7abc-8def-0123456789ab', name: 'Existing' }
    const pending = deferred<McpCapabilityCredentialResult>()
    createCapabilityProfile.mockReturnValueOnce(pending.promise)
    const creating = controller.createCapabilityProfile({ name: 'Agent', preset: 'read-only' })
    listCapabilityProfiles.mockResolvedValueOnce([existing, profile])
    await controller.loadCapabilityProfiles()
    pending.resolve({ profile, credential: 'test-credential' })
    await expect(creating).resolves.toBe(true)

    expect(controller.capabilityProfiles.value).toEqual([existing, profile])
    expect(controller.capabilityCredential.value).toBe('test-credential')
    controller.dispose()
  })

  it.each(['resolve', 'reject'] as const)('ignores an older profile refresh that will %s after a newer refresh', async (outcome) => {
    const { controller, listCapabilityProfiles } = createController()
    const pending = deferred<McpCapabilityProfileSummary[]>()
    listCapabilityProfiles.mockReturnValueOnce(pending.promise)
    const older = controller.loadCapabilityProfiles()
    listCapabilityProfiles.mockRejectedValueOnce(new Error('Current refresh failed'))
    await controller.loadCapabilityProfiles()
    if (outcome === 'resolve') pending.resolve([])
    else pending.reject(new Error('Stale refresh failed'))
    await expect(older).resolves.toBe(false)
    expect(controller.capabilityError.value).toBe('Current refresh failed')
    controller.dispose()
  })

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
      mcpRemoteAccess: false,
      mcpAuthentication: true,
      mcpPort: 49_000
    }
    resetSettings.mockRejectedValueOnce(new Error('default port already in use'))

    await expect(controller.reset()).resolves.toBe(false)

    expect(settings.value).toMatchObject({
      mcpRemoteAccess: false,
      mcpAuthentication: true,
      mcpPort: 49_000
    })
    expect(setAuthentication).not.toHaveBeenCalled()
    expect(setPort).not.toHaveBeenCalled()
    controller.dispose()
  })

  it.each(['create', 'rotate'] as const)(
    'does not restore a dismissed credential after a pending %s completes',
    async (action) => {
      const { controller, createCapabilityProfile, rotateCapabilityProfile } = createController()
      const profile: McpCapabilityProfileSummary = {
        id: '01912345-6788-7abc-8def-0123456789ab', name: 'Agent', revision: 1,
        credentialId: '11111111-1111-4111-8111-111111111111', allowedTools: ['browser_snapshot'],
        operationClasses: ['read'], useCount: 0, lineageActive: true,
        createdAt: '2026-09-11T12:00:00.000Z', updatedAt: '2026-09-11T12:00:00.000Z'
      }
      if (action === 'rotate') controller.capabilityProfiles.value = [profile]
      const pending = deferred<McpCapabilityCredentialResult>()
      createCapabilityProfile.mockReturnValueOnce(pending.promise)
      rotateCapabilityProfile.mockReturnValueOnce(pending.promise)
      const operation = action === 'create'
        ? controller.createCapabilityProfile({ name: 'Agent', preset: 'read-only' })
        : controller.rotateCapabilityProfile(profile.id)
      // The panel invokes this on unmount as well as explicit dismissal.
      controller.clearCapabilityCredential()
      const updated = { ...profile, revision: 2 }
      pending.resolve({ profile: updated, credential: 'dismissed-credential' })
      await expect(operation).resolves.toBe(true)

      expect(controller.capabilityCredential.value).toBe('')
      expect(controller.capabilityProfiles.value).toEqual([updated])
      expect(controller.capabilityBusy.value).toBe(false)
      rotateCapabilityProfile.mockReset().mockResolvedValueOnce({ profile: updated, credential: 'fresh-credential' })
      await controller.rotateCapabilityProfile(profile.id)
      expect(controller.capabilityCredential.value).toBe('fresh-credential')
      controller.dispose()
    }
  )

  it('discards a credential returned after the settings controller is disposed', async () => {
    const created = deferred<McpCapabilityCredentialResult>()
    const { controller, createCapabilityProfile } = createController()
    createCapabilityProfile.mockImplementationOnce(() => created.promise)

    const operation = controller.createCapabilityProfile({ name: 'Late', preset: 'read-only' })
    controller.dispose()
    created.resolve({
      profile: {
        id: '01912345-6789-7abc-8def-0123456789ab', name: 'Late', revision: 1,
        credentialId: '11111111-1111-4111-8111-111111111111', allowedTools: ['browser_snapshot'],
        operationClasses: ['read'], useCount: 0, lineageActive: true,
        createdAt: '2026-09-11T12:00:00.000Z', updatedAt: '2026-09-11T12:00:00.000Z'
      },
      credential: `hrc1_${'b'.repeat(43)}`
    })

    await expect(operation).resolves.toBe(false)
    expect(controller.capabilityCredential.value).toBe('')
    expect(controller.capabilityProfiles.value).toEqual([])
  })
})

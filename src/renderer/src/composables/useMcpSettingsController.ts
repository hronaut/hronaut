import { computed, ref, watch, type Ref } from 'vue'
import type {
  AppSettings,
  McpCapabilityCredentialResult,
  McpCapabilityProfileCreateInput,
  McpCapabilityProfileSummary
} from '../../../shared/types.js'
import type { McpToolSet } from '../../../shared/mcp-tool-sets.js'
import {
  DEFAULT_MCP_PORT,
  MAX_MCP_PORT,
  MIN_MCP_PORT,
  isValidMcpPort
} from '../../../shared/mcp-port.js'

type McpPortState = 'idle' | 'saving' | 'saved' | 'error'
type McpOperation = 'idle' | 'authentication' | 'tool-set' | 'port' | 'reset'

export interface McpSettingsControllerOptions {
  settings: Readonly<Ref<AppSettings>>
  endpoint: Readonly<Ref<string>>
  listenerFailed: Readonly<Ref<boolean>>
  setAuthentication: (enabled: boolean) => Promise<AppSettings>
  setToolSet: (toolSet: McpToolSet) => Promise<AppSettings>
  setPort: (port: number) => Promise<AppSettings>
  resetSettings: () => Promise<AppSettings>
  listCapabilityProfiles: () => Promise<McpCapabilityProfileSummary[]>
  createCapabilityProfile: (input: McpCapabilityProfileCreateInput) => Promise<McpCapabilityCredentialResult>
  rotateCapabilityProfile: (id: string) => Promise<McpCapabilityCredentialResult>
  revokeCapabilityProfile: (id: string) => Promise<McpCapabilityProfileSummary>
  confirmDisableAuthentication: () => boolean
  translate: (key: string, parameters?: Record<string, unknown>) => string
  formatPortError: (error: unknown) => string
  onAuthenticationError: (error: unknown) => void
}

export function useMcpSettingsController(options: McpSettingsControllerOptions) {
  const portDraft = ref(String(options.settings.value.mcpPort))
  const portState = ref<McpPortState>('idle')
  const portMessage = ref('')
  const operation = ref<McpOperation>('idle')
  const capabilityProfiles = ref<McpCapabilityProfileSummary[]>([])
  const capabilityCredential = ref('')
  const capabilityError = ref('')
  const capabilityBusy = ref(false)
  let dirtyPortDraft = false
  let draftRevision = 0
  let generation = 0

  const parsedPort = computed(() => Number(portDraft.value))
  const portValid = computed(() => isValidMcpPort(parsedPort.value))
  const portChanged = computed(() => portValid.value && parsedPort.value !== options.settings.value.mcpPort)
  const busy = computed(() => operation.value !== 'idle')
  const canApplyPort = computed(() => (
    !busy.value
    && portValid.value
    && (portChanged.value || options.listenerFailed.value)
  ))

  const stopWatchingPort = watch(
    () => options.settings.value.mcpPort,
    (port) => {
      if (operation.value === 'port' || operation.value === 'reset' || dirtyPortDraft) return
      portDraft.value = String(port)
    }
  )

  function editPort(value: string): void {
    portDraft.value = value
    dirtyPortDraft = value !== String(options.settings.value.mcpPort)
    draftRevision += 1
    if (operation.value === 'port' || operation.value === 'reset') return
    portState.value = 'idle'
    portMessage.value = ''
  }

  function invalidPort(): false {
    portState.value = 'error'
    portMessage.value = options.translate('runtimeActions.mcp.invalidPort', {
      min: MIN_MCP_PORT,
      max: MAX_MCP_PORT
    })
    return false
  }

  async function movePort(port: number, operationGeneration: number, startingDraftRevision: number): Promise<boolean> {
    portState.value = 'saving'
    portMessage.value = options.translate('runtimeActions.mcp.moving', { port })
    try {
      const next = await options.setPort(port)
      if (operationGeneration !== generation) return false
      if (draftRevision === startingDraftRevision) {
        portDraft.value = String(next.mcpPort)
        dirtyPortDraft = false
        portState.value = 'saved'
        portMessage.value = options.translate('runtimeActions.mcp.active', { port: next.mcpPort })
      } else {
        dirtyPortDraft = portDraft.value !== String(options.settings.value.mcpPort)
        portState.value = 'idle'
        portMessage.value = ''
      }
      return true
    } catch (error) {
      if (operationGeneration !== generation) return false
      portState.value = 'error'
      portMessage.value = options.formatPortError(error)
      return false
    }
  }

  async function setAuthentication(enabled: boolean): Promise<boolean> {
    if (busy.value) return false
    if (!enabled && !options.confirmDisableAuthentication()) return false
    const operationGeneration = generation
    operation.value = 'authentication'
    try {
      await options.setAuthentication(enabled)
      return operationGeneration === generation
    } catch (error) {
      if (operationGeneration === generation) options.onAuthenticationError(error)
      return false
    } finally {
      if (operationGeneration === generation) operation.value = 'idle'
    }
  }

  async function setToolSet(toolSet: McpToolSet): Promise<boolean> {
    if (busy.value || toolSet === options.settings.value.mcpToolSet) return false
    const operationGeneration = generation
    operation.value = 'tool-set'
    try {
      await options.setToolSet(toolSet)
      return operationGeneration === generation
    } catch (error) {
      if (operationGeneration === generation) options.onAuthenticationError(error)
      return false
    } finally {
      if (operationGeneration === generation) operation.value = 'idle'
    }
  }

  async function applyPort(): Promise<boolean> {
    if (busy.value) return false
    if (!portValid.value) return invalidPort()
    if (!portChanged.value && !options.listenerFailed.value) return false
    const operationGeneration = generation
    const startingDraftRevision = draftRevision
    const requestedPort = parsedPort.value
    operation.value = 'port'
    try {
      return await movePort(requestedPort, operationGeneration, startingDraftRevision)
    } finally {
      if (operationGeneration === generation) operation.value = 'idle'
    }
  }

  async function reset(): Promise<boolean> {
    if (busy.value) return false
    const operationGeneration = generation
    const startingDraftRevision = draftRevision + 1
    operation.value = 'reset'
    portDraft.value = String(DEFAULT_MCP_PORT)
    dirtyPortDraft = true
    draftRevision = startingDraftRevision
    portState.value = 'saving'
    portMessage.value = options.translate('runtimeActions.mcp.moving', { port: DEFAULT_MCP_PORT })
    try {
      const next = await options.resetSettings()
      if (operationGeneration !== generation) return false
      if (draftRevision === startingDraftRevision) {
        portDraft.value = String(next.mcpPort)
        dirtyPortDraft = false
        portState.value = 'saved'
        portMessage.value = options.translate('runtimeActions.mcp.active', { port: next.mcpPort })
      } else {
        dirtyPortDraft = portDraft.value !== String(options.settings.value.mcpPort)
        portState.value = 'idle'
        portMessage.value = ''
      }
      return true
    } catch (error) {
      if (operationGeneration === generation) {
        portState.value = 'error'
        portMessage.value = options.formatPortError(error)
      }
      return false
    } finally {
      if (operationGeneration === generation) operation.value = 'idle'
    }
  }

  async function loadCapabilityProfiles(): Promise<boolean> {
    const operationGeneration = generation
    capabilityError.value = ''
    try {
      const profiles = await options.listCapabilityProfiles()
      if (operationGeneration !== generation) return false
      capabilityProfiles.value = reconcileCapabilityLineage(profiles)
      return true
    } catch (error) {
      if (operationGeneration === generation) capabilityError.value = options.formatPortError(error)
      return false
    }
  }

  async function createCapabilityProfile(input: McpCapabilityProfileCreateInput): Promise<boolean> {
    if (capabilityBusy.value) return false
    const operationGeneration = generation
    capabilityBusy.value = true
    capabilityError.value = ''
    try {
      const created = await options.createCapabilityProfile(input)
      if (operationGeneration !== generation) return false
      capabilityProfiles.value = reconcileCapabilityLineage([...capabilityProfiles.value, created.profile])
      capabilityCredential.value = created.credential
      return true
    } catch (error) {
      if (operationGeneration === generation) capabilityError.value = options.formatPortError(error)
      return false
    } finally {
      if (operationGeneration === generation) capabilityBusy.value = false
    }
  }

  async function rotateCapabilityProfile(id: string): Promise<boolean> {
    if (capabilityBusy.value) return false
    const operationGeneration = generation
    capabilityBusy.value = true
    capabilityError.value = ''
    try {
      const rotated = await options.rotateCapabilityProfile(id)
      if (operationGeneration !== generation) return false
      capabilityProfiles.value = reconcileCapabilityLineage(
        capabilityProfiles.value.map(profile => profile.id === id ? rotated.profile : profile)
      )
      capabilityCredential.value = rotated.credential
      return true
    } catch (error) {
      if (operationGeneration === generation) capabilityError.value = options.formatPortError(error)
      return false
    } finally {
      if (operationGeneration === generation) capabilityBusy.value = false
    }
  }

  async function revokeCapabilityProfile(id: string): Promise<boolean> {
    if (capabilityBusy.value) return false
    const operationGeneration = generation
    capabilityBusy.value = true
    capabilityError.value = ''
    try {
      const revoked = await options.revokeCapabilityProfile(id)
      if (operationGeneration !== generation) return false
      capabilityProfiles.value = reconcileCapabilityLineage(
        capabilityProfiles.value.map(profile => profile.id === id ? revoked : profile)
      )
      return true
    } catch (error) {
      if (operationGeneration === generation) capabilityError.value = options.formatPortError(error)
      return false
    } finally {
      if (operationGeneration === generation) capabilityBusy.value = false
    }
  }

  function clearCapabilityCredential(): void {
    capabilityCredential.value = ''
  }

  function reconcileCapabilityLineage(profiles: McpCapabilityProfileSummary[]): McpCapabilityProfileSummary[] {
    const byId = new Map(profiles.map(profile => [profile.id, profile]))
    const resolved = new Map<string, boolean>()
    const active = (profile: McpCapabilityProfileSummary, visiting: Set<string>): boolean => {
      const cached = resolved.get(profile.id)
      if (cached !== undefined) return cached
      if (!profile.lineageActive || visiting.has(profile.id)) {
        resolved.set(profile.id, false)
        return false
      }
      const parentAuthorization = profile.parentAuthorization
      if (!parentAuthorization) {
        resolved.set(profile.id, true)
        return true
      }
      const parent = byId.get(parentAuthorization.profileId)
      if (!parent || parent.revision !== parentAuthorization.revision
        || parent.credentialId !== parentAuthorization.credentialId) {
        resolved.set(profile.id, false)
        return false
      }
      const nextVisiting = new Set(visiting)
      nextVisiting.add(profile.id)
      const value = active(parent, nextVisiting)
      resolved.set(profile.id, value)
      return value
    }
    return profiles.map(profile => ({ ...profile, lineageActive: active(profile, new Set()) }))
  }

  function dispose(): void {
    generation += 1
    operation.value = 'idle'
    capabilityBusy.value = false
    capabilityCredential.value = ''
    stopWatchingPort()
  }

  return {
    settings: options.settings,
    endpoint: options.endpoint,
    portDraft,
    portState,
    portMessage,
    busy,
    canApplyPort,
    editPort,
    setAuthentication,
    setToolSet,
    applyPort,
    capabilityProfiles,
    capabilityCredential,
    capabilityError,
    capabilityBusy,
    loadCapabilityProfiles,
    createCapabilityProfile,
    rotateCapabilityProfile,
    revokeCapabilityProfile,
    clearCapabilityCredential,
    reset,
    dispose
  }
}

export type McpSettingsController = ReturnType<typeof useMcpSettingsController>

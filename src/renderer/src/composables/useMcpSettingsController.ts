import { computed, ref, watch, type Ref } from 'vue'
import type {
  AppSettings,
  McpPortMoveResult,
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
import type { CopyTextWithFeedback } from './useShellFeedbackController.js'

type McpPortState = 'idle' | 'saving' | 'saved' | 'error'
type McpOperation = 'idle' | 'remote-access' | 'authentication' | 'tool-set' | 'challenge-detection' | 'url-detail' | 'port' | 'reset'

export interface McpSettingsControllerOptions {
  settings: Readonly<Ref<AppSettings>>
  endpoint: Readonly<Ref<string>>
  listenerFailed: Readonly<Ref<boolean>>
  /** A free port main found after the configured one was busy or refused; absent otherwise. */
  suggestedPort?: Readonly<Ref<number | undefined>>
  /** Why the listener could not use its port, in plain words; empty when it can or failed otherwise. */
  listenerProblem?: Readonly<Ref<string>>
  /** Moves the listener to `suggestedPort` through main, which re-checks the port and offers the next one if needed. */
  moveToSuggestedPort?: () => Promise<McpPortMoveResult | null>
  setRemoteAccess: (enabled: boolean) => Promise<AppSettings>
  setAuthentication: (enabled: boolean) => Promise<AppSettings>
  setChallengeDetectionEnabled: (enabled: boolean) => Promise<AppSettings>
  setOmitAgentUrlDetail: (enabled: boolean) => Promise<AppSettings>
  setToolSet: (toolSet: McpToolSet) => Promise<AppSettings>
  setPort: (port: number) => Promise<AppSettings>
  resetSettings: () => Promise<AppSettings>
  listCapabilityProfiles: () => Promise<McpCapabilityProfileSummary[]>
  createCapabilityProfile: (input: McpCapabilityProfileCreateInput) => Promise<McpCapabilityCredentialResult>
  rotateCapabilityProfile: (id: string) => Promise<McpCapabilityCredentialResult>
  revokeCapabilityProfile: (id: string) => Promise<McpCapabilityProfileSummary>
  confirmDisableAuthentication: () => boolean
  /** Copies a credential and itself tells the person when the copy fails. */
  copyText: CopyTextWithFeedback
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
  /** The credential on screen was copied; any newer credential, Dismiss or disposal clears it. */
  const capabilityCopied = ref(false)
  let dirtyPortDraft = false
  let draftRevision = 0
  let generation = 0
  let capabilityListSequence = 0
  let credentialDisplayGeneration = 0
  let credentialCopySequence = 0

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
    const startingSettings = options.settings.value
    portState.value = 'saving'
    portMessage.value = options.translate('runtimeActions.mcp.moving', { port })
    try {
      const next = await options.setPort(port)
      if (operationGeneration !== generation) return false
      const currentPort = options.settings.value === startingSettings ? next.mcpPort : options.settings.value.mcpPort
      if (draftRevision === startingDraftRevision) {
        portDraft.value = String(currentPort)
        dirtyPortDraft = false
        portState.value = 'saved'
        portMessage.value = options.translate('runtimeActions.mcp.active', { port: currentPort })
      } else {
        dirtyPortDraft = portDraft.value !== String(options.settings.value.mcpPort)
        portState.value = 'idle'
        portMessage.value = ''
      }
      return true
    } catch (error) {
      if (operationGeneration !== generation) return false
      if (draftRevision === startingDraftRevision) {
        portState.value = 'error'
        portMessage.value = options.formatPortError(error)
      } else {
        dirtyPortDraft = portDraft.value !== String(options.settings.value.mcpPort)
        portState.value = 'idle'
        portMessage.value = ''
      }
      return false
    }
  }

  async function setRemoteAccess(enabled: boolean): Promise<boolean> {
    if (busy.value) return false
    const operationGeneration = generation
    operation.value = 'remote-access'
    try {
      await options.setRemoteAccess(enabled)
      return operationGeneration === generation
    } catch (error) {
      if (operationGeneration === generation) options.onAuthenticationError(error)
      return false
    } finally {
      if (operationGeneration === generation) operation.value = 'idle'
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

  async function setChallengeDetectionEnabled(enabled: boolean): Promise<boolean> {
    if (busy.value) return false
    const operationGeneration = generation
    operation.value = 'challenge-detection'
    try {
      await options.setChallengeDetectionEnabled(enabled)
      return operationGeneration === generation
    } catch (error) {
      if (operationGeneration === generation) options.onAuthenticationError(error)
      return false
    } finally {
      if (operationGeneration === generation) operation.value = 'idle'
    }
  }

  async function setOmitAgentUrlDetail(enabled: boolean): Promise<boolean> {
    if (busy.value) return false
    const operationGeneration = generation
    operation.value = 'url-detail'
    try {
      await options.setOmitAgentUrlDetail(enabled)
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

  /** Moves the listener to the free port main offered; a port taken meanwhile is said so, and main offers the next one. */
  async function applySuggestedPort(): Promise<boolean> {
    const port = options.suggestedPort?.value
    if (busy.value || !port || !options.listenerFailed.value || !options.moveToSuggestedPort) return false
    const operationGeneration = generation
    const startingDraftRevision = draftRevision
    operation.value = 'port'
    portState.value = 'saving'
    portMessage.value = options.translate('runtimeActions.mcp.moving', { port })
    try {
      const result = await options.moveToSuggestedPort()
      if (operationGeneration !== generation) return false
      if (result?.outcome === 'moved') {
        // A port the person typed meanwhile stays in the field.
        if (draftRevision === startingDraftRevision) {
          portDraft.value = String(result.port)
          dirtyPortDraft = false
        }
        portState.value = 'saved'
        portMessage.value = options.translate('runtimeActions.mcp.active', { port: result.port })
        return true
      }
      portState.value = result?.outcome === 'taken' || result?.outcome === 'failed' ? 'error' : 'idle'
      portMessage.value = result?.outcome === 'taken' ? options.translate('runtime.mcp.portTaken', { port: result.port })
        : result?.outcome === 'failed' ? options.translate('runtime.mcp.portMoveFailed', { port: result.port })
          : ''
      return false
    } finally {
      if (operationGeneration === generation) operation.value = 'idle'
    }
  }

  async function reset(): Promise<boolean> {
    if (busy.value) return false
    const startingSettings = options.settings.value
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
      const currentPort = options.settings.value === startingSettings ? next.mcpPort : options.settings.value.mcpPort
      if (draftRevision === startingDraftRevision) {
        portDraft.value = String(currentPort)
        dirtyPortDraft = false
        portState.value = 'saved'
        portMessage.value = options.translate('runtimeActions.mcp.active', { port: currentPort })
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
    const listSequence = ++capabilityListSequence
    capabilityError.value = ''
    try {
      const profiles = await options.listCapabilityProfiles()
      if (operationGeneration !== generation || listSequence !== capabilityListSequence) return false
      capabilityProfiles.value = reconcileCapabilityLineage(profiles)
      return true
    } catch (error) {
      if (operationGeneration === generation && listSequence === capabilityListSequence) capabilityError.value = options.formatPortError(error)
      return false
    }
  }

  async function createCapabilityProfile(input: McpCapabilityProfileCreateInput): Promise<boolean> {
    if (capabilityBusy.value) return false
    const operationGeneration = generation
    const displayGeneration = credentialDisplayGeneration
    capabilityBusy.value = true
    capabilityError.value = ''
    try {
      const created = await options.createCapabilityProfile(input)
      if (operationGeneration !== generation) return false
      capabilityListSequence += 1
      capabilityProfiles.value = reconcileCapabilityLineage([
        ...capabilityProfiles.value.filter(profile => profile.id !== created.profile.id),
        created.profile
      ])
      if (displayGeneration === credentialDisplayGeneration) showCapabilityCredential(created.credential)
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
    const displayGeneration = credentialDisplayGeneration
    capabilityBusy.value = true
    capabilityError.value = ''
    try {
      const rotated = await options.rotateCapabilityProfile(id)
      if (operationGeneration !== generation) return false
      capabilityListSequence += 1
      capabilityProfiles.value = reconcileCapabilityLineage(
        capabilityProfiles.value.map(profile => profile.id === id ? rotated.profile : profile)
      )
      if (displayGeneration === credentialDisplayGeneration) showCapabilityCredential(rotated.credential)
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
      capabilityListSequence += 1
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

  /** A copy still pending no longer belongs to what is on screen: its result changes nothing and reports nothing. */
  function resetCredentialCopy(): void {
    credentialCopySequence += 1
    capabilityCopied.value = false
  }

  function showCapabilityCredential(credential: string): void {
    resetCredentialCopy()
    capabilityCredential.value = credential
  }

  /**
   * Copies the credential on screen; it reads as copied only while that same credential is still shown.
   * A failed copy is still reported after Dismiss or a newer credential, because the credential is shown
   * only once and the person has to know it never reached the clipboard.
   */
  async function copyCapabilityCredential(): Promise<boolean> {
    const credential = capabilityCredential.value
    if (!credential) return false
    resetCredentialCopy()
    const operationGeneration = generation
    const sequence = credentialCopySequence
    const panelOpen = (): boolean => operationGeneration === generation
    const ownsFeedback = (): boolean => (
      panelOpen()
      && sequence === credentialCopySequence
      && capabilityCredential.value === credential
    )
    if (!await options.copyText(credential, panelOpen) || !ownsFeedback()) return false
    capabilityCopied.value = true
    return true
  }

  function clearCapabilityCredential(): void {
    credentialDisplayGeneration += 1
    resetCredentialCopy()
    capabilityCredential.value = ''
  }

  /** Clears an error that belongs to something no longer on screen, unless a newer error replaced it meanwhile. */
  function clearCapabilityError(error: string): void {
    if (capabilityError.value === error) capabilityError.value = ''
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
    resetCredentialCopy()
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
    setRemoteAccess,
    setAuthentication,
    setChallengeDetectionEnabled,
    setOmitAgentUrlDetail,
    setToolSet,
    applyPort,
    applySuggestedPort,
    suggestedPort: computed(() => options.suggestedPort?.value),
    listenerProblem: computed(() => options.listenerProblem?.value ?? ''),
    capabilityProfiles,
    capabilityCredential,
    capabilityError,
    capabilityBusy,
    capabilityCopied,
    loadCapabilityProfiles,
    createCapabilityProfile,
    rotateCapabilityProfile,
    revokeCapabilityProfile,
    copyCapabilityCredential,
    clearCapabilityCredential,
    clearCapabilityError,
    reset,
    dispose
  }
}

export type McpSettingsController = ReturnType<typeof useMcpSettingsController>

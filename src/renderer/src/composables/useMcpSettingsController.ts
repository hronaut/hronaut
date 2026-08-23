import { computed, ref, watch, type Ref } from 'vue'
import type { AppSettings } from '../../../shared/types.js'
import {
  DEFAULT_MCP_PORT,
  MAX_MCP_PORT,
  MIN_MCP_PORT,
  isValidMcpPort
} from '../../../shared/mcp-port.js'

type McpPortState = 'idle' | 'saving' | 'saved' | 'error'
type McpOperation = 'idle' | 'authentication' | 'port' | 'reset'

export interface McpSettingsControllerOptions {
  settings: Readonly<Ref<AppSettings>>
  endpoint: Readonly<Ref<string>>
  listenerFailed: Readonly<Ref<boolean>>
  setAuthentication: (enabled: boolean) => Promise<AppSettings>
  setPort: (port: number) => Promise<AppSettings>
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

  async function applyPort(): Promise<boolean> {
    if (busy.value) return false
    if (!portValid.value) return invalidPort()
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
    operation.value = 'reset'
    portState.value = 'idle'
    portMessage.value = ''
    try {
      try {
        await options.setAuthentication(false)
      } catch (error) {
        if (operationGeneration === generation) options.onAuthenticationError(error)
        return false
      }
      if (operationGeneration !== generation) return false
      portDraft.value = String(DEFAULT_MCP_PORT)
      dirtyPortDraft = true
      draftRevision += 1
      return await movePort(DEFAULT_MCP_PORT, operationGeneration, draftRevision)
    } finally {
      if (operationGeneration === generation) operation.value = 'idle'
    }
  }

  function dispose(): void {
    generation += 1
    operation.value = 'idle'
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
    applyPort,
    reset,
    dispose
  }
}

export type McpSettingsController = ReturnType<typeof useMcpSettingsController>

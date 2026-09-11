import { createHash } from 'node:crypto'
import type { BrowserState } from '../../shared/types.js'

export const BROWSER_ACTION_OPERATION_CLASSES = [
  'navigation', 'page-interaction', 'browser-state', 'site-data', 'network', 'external-request'
] as const
export type BrowserActionOperationClass = typeof BROWSER_ACTION_OPERATION_CLASSES[number]

export const BROWSER_ACTION_TARGET_KINDS = [
  'tab', 'element-ref', 'selector', 'coordinates', 'drag', 'form', 'origin', 'script', 'request'
] as const
export type BrowserActionTargetKind = typeof BROWSER_ACTION_TARGET_KINDS[number]

export const BROWSER_ACTION_AUTHORITY_REASONS = [
  'WORKSPACE_CHANGED', 'PERMISSION_CHANGED', 'TARGET_CHANGED', 'ORIGIN_CHANGED',
  'NAVIGATION_CHANGED', 'EXPECTED_STATE_CHANGED', 'SITE_POLICY_CHANGED'
] as const
export type BrowserActionAuthorityReason = typeof BROWSER_ACTION_AUTHORITY_REASONS[number]

export interface BrowserActionAuthority {
  workspaceId: string
  tabId: string
  topLevelOrigin: string
  navigationGeneration: number
  observationGeneration: number
  humanInteractionGeneration: number
  policyFingerprint: string
  targetFingerprint: string
  authorizationFingerprint: string
  payloadFingerprint: string
  operationClass: BrowserActionOperationClass
  targetKind: BrowserActionTargetKind
  targetId: string
}

export interface BrowserActionTarget {
  kind: BrowserActionTargetKind
  value: unknown
}

function topLevelOrigin(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.origin === 'null' ? parsed.protocol : parsed.origin
  } catch {
    return 'invalid:'
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function policyFingerprint(state: BrowserState, workspaceId: string): string {
  const policy = state.mcpTabGroups?.find(group => group.id === workspaceId)?.navigationPolicy
  return digest(policy ?? null)
}

export function captureBrowserActionAuthority(options: {
  state: BrowserState
  workspaceId: string
  tabId: string
  operationClass: BrowserActionOperationClass
  target: BrowserActionTarget
  targetId: string
  authorizationFingerprint: string
  payloadFingerprint: string
}): BrowserActionAuthority {
  const tab = options.state.tabs.find(candidate => candidate.id === options.tabId)
  if (!tab) throw new Error('The authorized action target is unavailable')
  return {
    workspaceId: options.workspaceId,
    tabId: options.tabId,
    topLevelOrigin: topLevelOrigin(tab.url),
    navigationGeneration: tab.navigationGeneration,
    observationGeneration: tab.observationGeneration ?? 0,
    humanInteractionGeneration: tab.humanInteractionGeneration ?? 0,
    policyFingerprint: policyFingerprint(options.state, options.workspaceId),
    targetFingerprint: digest(options.target),
    authorizationFingerprint: options.authorizationFingerprint,
    payloadFingerprint: options.payloadFingerprint,
    operationClass: options.operationClass,
    targetKind: options.target.kind,
    targetId: options.targetId
  }
}

export function browserActionAuthorityReason(options: {
  expected: BrowserActionAuthority
  state: BrowserState
  workspaceId: string
  tabId: string
  target: BrowserActionTarget
  permitted: boolean
  authorizationFingerprint: string
  payloadFingerprint: string
}): BrowserActionAuthorityReason | undefined {
  const { expected } = options
  if (options.workspaceId !== expected.workspaceId) return 'WORKSPACE_CHANGED'
  if (!options.permitted) return 'PERMISSION_CHANGED'
  if (options.authorizationFingerprint !== expected.authorizationFingerprint) return 'PERMISSION_CHANGED'
  const tab = options.state.tabs.find(candidate => candidate.id === options.tabId)
  if (!tab || options.tabId !== expected.tabId) return 'TARGET_CHANGED'
  if (topLevelOrigin(tab.url) !== expected.topLevelOrigin) return 'ORIGIN_CHANGED'
  if (tab.navigationGeneration !== expected.navigationGeneration) return 'NAVIGATION_CHANGED'
  if ((tab.observationGeneration ?? 0) !== expected.observationGeneration) return 'EXPECTED_STATE_CHANGED'
  if ((tab.humanInteractionGeneration ?? 0) !== expected.humanInteractionGeneration) return 'EXPECTED_STATE_CHANGED'
  if (policyFingerprint(options.state, options.workspaceId) !== expected.policyFingerprint) return 'SITE_POLICY_CHANGED'
  if (digest(options.target) !== expected.targetFingerprint) return 'TARGET_CHANGED'
  if (options.payloadFingerprint !== expected.payloadFingerprint) return 'TARGET_CHANGED'
  return undefined
}

/** Returns only a digest. Callers must not retain or log the source payload. */
export function browserActionPayloadFingerprint(input: Record<string, unknown>): string {
  return digest(input)
}

export function browserActionOperationClass(toolName: string): BrowserActionOperationClass {
  if (toolName === 'browser_navigate' || toolName === 'browser_history') return 'navigation'
  if (toolName === 'browser_storage' || toolName === 'browser_site_data') return 'site-data'
  if (toolName.startsWith('browser_network')) return 'network'
  if (toolName === 'browser_downloads' || toolName === 'browser_file_upload') return 'external-request'
  if (['browser_click', 'browser_dialog', 'browser_type', 'browser_select', 'browser_fill_form',
    'browser_hover', 'browser_drag', 'browser_scroll', 'browser_press', 'browser_evaluate'].includes(toolName)) {
    return 'page-interaction'
  }
  return 'browser-state'
}

export function browserActionTarget(input: Record<string, unknown>): BrowserActionTarget {
  if (typeof input.ref === 'string') return { kind: 'element-ref', value: { ref: input.ref } }
  if (typeof input.selector === 'string') return { kind: 'selector', value: { selector: input.selector } }
  if (typeof input.sourceRef === 'string' || typeof input.sourceSelector === 'string'
    || typeof input.targetRef === 'string' || typeof input.targetSelector === 'string') {
    return {
      kind: 'drag',
      value: {
        sourceRef: input.sourceRef, sourceSelector: input.sourceSelector,
        targetRef: input.targetRef, targetSelector: input.targetSelector
      }
    }
  }
  if (typeof input.x === 'number' && typeof input.y === 'number') {
    return { kind: 'coordinates', value: { x: input.x, y: input.y } }
  }
  if (typeof input.startX === 'number' && typeof input.startY === 'number'
    && typeof input.endX === 'number' && typeof input.endY === 'number') {
    return {
      kind: 'drag',
      value: { startX: input.startX, startY: input.startY, endX: input.endX, endY: input.endY }
    }
  }
  if (Array.isArray(input.fields)) {
    return {
      kind: 'form',
      value: input.fields.map(field => {
        if (!field || typeof field !== 'object') return null
        const candidate = field as Record<string, unknown>
        return typeof candidate.ref === 'string' ? { ref: candidate.ref }
          : typeof candidate.selector === 'string' ? { selector: candidate.selector } : null
      })
    }
  }
  if (typeof input.url === 'string') return { kind: 'origin', value: { url: input.url } }
  if (typeof input.origin === 'string') return { kind: 'origin', value: { origin: input.origin } }
  if (typeof input.script === 'string') return { kind: 'script', value: { script: input.script } }
  for (const key of ['requestId', 'downloadId', 'routeId']) {
    if (typeof input[key] === 'string') return { kind: 'request', value: { [key]: input[key] } }
  }
  if (typeof input.action === 'string') return { kind: 'request', value: { action: input.action } }
  return { kind: 'tab', value: null }
}

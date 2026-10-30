import { installReactInspection } from './react-inspection-bootstrap.js'
import { contextBridge } from 'electron'
import type { HronautHomeApi } from '../shared/home.js'
import type { WalletProviderEvent, WalletProviderRequest } from '../shared/wallet.js'
import { installHronautWalletProviders } from './wallet-provider-bootstrap.js'
import { installFixedDate } from './fixed-date-bootstrap.js'
import { HOME_IPC } from '../shared/ipc/home.js'
import { PAGE_IPC } from '../shared/ipc/page.js'
import { WALLET_PROVIDER_IPC } from '../shared/ipc/wallet-provider.js'
import { invoke, send, sendSync, subscribe } from './bridges/ipc.js'

// Synchronous, main-owned opt-ins are resolved before any page scripts execute, in one answer, which the page waits
// for. Embedded frames never receive an installation authorization.
const bootstrap = location.protocol === 'http:' || location.protocol === 'https:'
  ? sendSync(PAGE_IPC.bootstrap)
  : undefined
const reactInspection = bootstrap?.reactInspection
if (reactInspection?.enabled && typeof reactInspection.installationId === 'string') {
  contextBridge.executeInMainWorld({ func: installReactInspection, args: [reactInspection.installationId] })
  subscribe(PAGE_IPC.reactInspectionDisable, () => window.dispatchEvent(new Event('hronaut:react-inspection:disable')))
}


const MAX_EXCEPTION_INPUT_CHARS = 64_000

interface PageErrorEvent {
  error?: unknown
  message?: string
  filename?: string
  lineno?: number
  colno?: number
}

interface PagePromiseRejectionEvent {
  reason?: unknown
}

interface PageWindow {
  addEventListener(type: 'error', listener: (event: PageErrorEvent) => void, capture: boolean): void
  addEventListener(type: 'unhandledrejection', listener: (event: PagePromiseRejectionEvent) => void, capture: boolean): void
  addEventListener(type: 'beforeprint' | 'afterprint', listener: (event: { isTrusted: boolean }) => void, capture: boolean): void
}

const pageWindow = globalThis as unknown as PageWindow
const pageLocation = (globalThis as unknown as {
  location?: { protocol?: string; hostname?: string }
}).location

if (pageLocation?.protocol === 'hronaut:' && pageLocation.hostname === 'home') {
  contextBridge.exposeInMainWorld('hronautHome', {
    onShowWorkspaces: (listener) => subscribe(HOME_IPC.showWorkspaces, () => listener()),
    onChanged: (listener) => subscribe(HOME_IPC.changed, () => listener()),
    getWorkspaces: () => invoke(HOME_IPC.workspaces),
    workspaceAction: (request) => invoke(HOME_IPC.workspaceAction, request),
    copyText: (text) => invoke(HOME_IPC.copyText, text),
    confirm: async (question) => await invoke(HOME_IPC.confirm, question) === true,
    openAgentGuide: (clientId) => invoke(HOME_IPC.openAgentGuide, clientId),
    openVsCodeInstall: () => invoke(HOME_IPC.openVsCodeInstall),
    openSetupHelp: () => invoke(HOME_IPC.openSetupHelp),
    openSetupFeedback: () => invoke(HOME_IPC.openSetupFeedback),
    getSetupState: () => invoke(HOME_IPC.setupState),
    prepareClaudeCodeSetup: () => invoke(HOME_IPC.claudeCodePrepare),
    applyClaudeCodeSetup: (planId) => invoke(HOME_IPC.claudeCodeApply, planId),
    useMcpPort: (port) => invoke(HOME_IPC.useMcpPort, port)
  } satisfies HronautHomeApi)
} else if (pageLocation?.protocol === 'http:' || pageLocation?.protocol === 'https:') {
  const walletListeners = new Set<(event: WalletProviderEvent) => void>()
  subscribe(WALLET_PROVIDER_IPC.event, (message) => {
    for (const listener of walletListeners) listener(message)
  })
  contextBridge.exposeInMainWorld('__hronautWalletBridge', {
    request: (input: WalletProviderRequest) => invoke(WALLET_PROVIDER_IPC.request, input),
    subscribe: (listener: (event: WalletProviderEvent) => void) => { walletListeners.add(listener) },
    unsubscribe: (listener: (event: WalletProviderEvent) => void) => { walletListeners.delete(listener) }
  })
  contextBridge.executeInMainWorld({ func: installHronautWalletProviders })
  // A fixed Date an agent staged for this tab and origin, decided by the main process before page scripts run.
  const fixedDate = bootstrap?.fixedDate
  if (fixedDate?.enabled && Number.isSafeInteger(fixedDate.epochMs)) {
    contextBridge.executeInMainWorld({ func: installFixedDate, args: [fixedDate.epochMs] })
  }
}

function bounded(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.slice(0, MAX_EXCEPTION_INPUT_CHARS)
  return normalized || undefined
}

function errorDetails(value: unknown): { message?: string; stack?: string } {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return {}
  try {
    const candidate = value as { message?: unknown; stack?: unknown }
    return { message: bounded(candidate.message), stack: bounded(candidate.stack) }
  } catch {
    return {}
  }
}

pageWindow.addEventListener('error', (event) => {
  const error = errorDetails(event.error)
  send(PAGE_IPC.exception, {
    timestamp: Date.now(),
    message: error.message ?? bounded(event.message) ?? 'Unhandled JavaScript exception',
    stack: error.stack,
    sourceId: bounded(event.filename),
    lineNumber: Number.isFinite(event.lineno) ? event.lineno : undefined,
    columnNumber: Number.isFinite(event.colno) ? event.colno : undefined
  })
}, true)

pageWindow.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  const error = errorDetails(reason)
  const primitiveReason = ['string', 'number', 'boolean', 'bigint'].includes(typeof reason)
    ? bounded(String(reason))
    : undefined
  send(PAGE_IPC.exception, {
    timestamp: Date.now(),
    message: error.message ?? primitiveReason ?? 'Unhandled promise rejection',
    stack: error.stack,
    promiseRejection: true
  })
}, true)

// A print dialog holds the page until the person prints or cancels, so the main process lets the calls waiting on the
// page go instead of keeping the agent's workspace busy. Only the browser's own print events count, not a page's copy.
for (const type of ['beforeprint', 'afterprint'] as const) {
  pageWindow.addEventListener(type, (event) => {
    if (event.isTrusted) send(PAGE_IPC.printDialog, type === 'beforeprint')
  }, true)
}

import { contextBridge, ipcRenderer } from 'electron'
import type { AgentGuideId } from '../shared/agent-guides.js'
import type { WalletProviderEvent, WalletProviderRequest } from '../shared/wallet.js'
import { installHronautWalletProviders } from './wallet-provider-bootstrap.js'

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
}

const pageWindow = globalThis as unknown as PageWindow
const pageLocation = (globalThis as unknown as {
  location?: { protocol?: string; hostname?: string }
}).location

if (pageLocation?.protocol === 'hronaut:' && pageLocation.hostname === 'home') {
  contextBridge.exposeInMainWorld('hronautHome', {
    copyText: (text: string) => ipcRenderer.invoke('hronaut-home:copy-text', text),
    openAgentGuide: (clientId: AgentGuideId) => ipcRenderer.invoke('hronaut-home:open-agent-guide', clientId),
    openVsCodeInstall: () => ipcRenderer.invoke('hronaut-home:open-vscode-install'),
    openSetupHelp: () => ipcRenderer.invoke('hronaut-home:open-setup-help'),
    openSetupFeedback: () => ipcRenderer.invoke('hronaut-home:open-setup-feedback')
  })
} else if (pageLocation?.protocol === 'http:' || pageLocation?.protocol === 'https:') {
  const walletListeners = new Set<(event: WalletProviderEvent) => void>()
  ipcRenderer.on('wallet-provider:event', (_event, message: WalletProviderEvent) => {
    for (const listener of walletListeners) listener(message)
  })
  contextBridge.exposeInMainWorld('__hronautWalletBridge', {
    request: (input: WalletProviderRequest) => ipcRenderer.invoke('wallet-provider:request', input),
    subscribe: (listener: (event: WalletProviderEvent) => void) => { walletListeners.add(listener) },
    unsubscribe: (listener: (event: WalletProviderEvent) => void) => { walletListeners.delete(listener) }
  })
  contextBridge.executeInMainWorld({ func: installHronautWalletProviders })
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
  ipcRenderer.send('hronaut:page-exception', {
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
  ipcRenderer.send('hronaut:page-exception', {
    timestamp: Date.now(),
    message: error.message ?? primitiveReason ?? 'Unhandled promise rejection',
    stack: error.stack,
    promiseRejection: true
  })
}, true)

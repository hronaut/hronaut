import { installReactInspection } from './react-inspection-bootstrap.js'
import type { PageBootstrap } from '../shared/page-bootstrap.js'
import { contextBridge, ipcRenderer } from 'electron'
import type { HomeWorkspaceAction } from '../shared/home-workspaces.js'
import type { HronautHomeApi } from '../shared/home.js'
import type { Confirmation } from '../shared/confirmation.js'
import type { AgentGuideId } from '../shared/agent-guides.js'
import type { WalletProviderEvent, WalletProviderRequest } from '../shared/wallet.js'
import { installHronautWalletProviders } from './wallet-provider-bootstrap.js'
import { installFixedDate } from './fixed-date-bootstrap.js'
import { PAGE_PRINT_DIALOG_CHANNEL } from '../shared/page-print-dialog.js'

// Synchronous, main-owned opt-ins are resolved before any page scripts execute, in one answer, which the page waits
// for. Embedded frames never receive an installation authorization.
const bootstrap = location.protocol === 'http:' || location.protocol === 'https:'
  ? ipcRenderer.sendSync('page:bootstrap') as PageBootstrap | undefined
  : undefined
const reactInspection = bootstrap?.reactInspection
if (reactInspection?.enabled && typeof reactInspection.installationId === 'string') {
  contextBridge.executeInMainWorld({ func: installReactInspection, args: [reactInspection.installationId] })
  ipcRenderer.on('react-inspection:disable', () => window.dispatchEvent(new Event('hronaut:react-inspection:disable')))
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
    onShowWorkspaces: (listener: () => void) => {
      const handler = (): void => listener()
      ipcRenderer.on('hronaut-home:show-workspaces', handler)
      return () => ipcRenderer.removeListener('hronaut-home:show-workspaces', handler)
    },
    onChanged: (listener: () => void) => {
      const handler = (): void => listener()
      ipcRenderer.on('hronaut-home:changed', handler)
      return () => ipcRenderer.removeListener('hronaut-home:changed', handler)
    },
    getWorkspaces: () => ipcRenderer.invoke('hronaut-home:workspaces'),
    workspaceAction: (request: HomeWorkspaceAction) => ipcRenderer.invoke('hronaut-home:workspace-action', request),
    copyText: (text: string) => ipcRenderer.invoke('hronaut-home:copy-text', text),
    confirm: async (question: Confirmation) => await ipcRenderer.invoke('hronaut-home:confirm', question) === true,
    openAgentGuide: (clientId: AgentGuideId) => ipcRenderer.invoke('hronaut-home:open-agent-guide', clientId),
    openVsCodeInstall: () => ipcRenderer.invoke('hronaut-home:open-vscode-install'),
    openSetupHelp: () => ipcRenderer.invoke('hronaut-home:open-setup-help'),
    openSetupFeedback: () => ipcRenderer.invoke('hronaut-home:open-setup-feedback'),
    getSetupState: () => ipcRenderer.invoke('hronaut-home:setup-state'),
    prepareClaudeCodeSetup: () => ipcRenderer.invoke('hronaut-home:claude-code-prepare'),
    applyClaudeCodeSetup: (planId: string) => ipcRenderer.invoke('hronaut-home:claude-code-apply', planId),
    useMcpPort: (port: number) => ipcRenderer.invoke('hronaut-home:use-mcp-port', port)
  } satisfies HronautHomeApi)
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

// A print dialog holds the page until the person prints or cancels, so the main process lets the calls waiting on the
// page go instead of keeping the agent's workspace busy. Only the browser's own print events count, not a page's copy.
for (const type of ['beforeprint', 'afterprint'] as const) {
  pageWindow.addEventListener(type, (event) => {
    if (event.isTrusted) ipcRenderer.send(PAGE_PRINT_DIALOG_CHANNEL, type === 'beforeprint')
  }, true)
}

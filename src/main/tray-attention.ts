import { randomUUID } from 'node:crypto'
import { Menu, nativeImage, Notification, Tray, type BrowserWindow, type NativeImage } from 'electron'
import { bindTrayActivation } from './tray-activation.js'
import trayIconPath from '../../build/icons/24x24.png?asset'
import trayAttentionIconPath from '../../build/icons/tray-attention.png?asset'
import type { BrowserTabsManager } from './browser/tabs-manager.js'
import type { McpHttpServer } from './mcp/server.js'
import type { UserAttentionLifecycle } from './user-attention-lifecycle.js'
import type { AgentPresenceSnapshot } from '../shared/agent-presence.js'
import type { MessageKey, MessageParameters } from '../shared/i18n.js'
import type {
  AppSettings,
  AppUpdateState,
  BrowserState,
  McpTabActivity,
  UserAttentionInput,
  UserAttentionRequest
} from '../shared/types.js'

/**
 * The attention request still open for the user, created once by index.ts. It shows as needs you until it is answered
 * or ends; a click or key only quiets it, which agents see as answered in status and preflight. The shell, Home, the
 * IPC handlers, agent presence and the MCP server read the fields when they run, so they always see the current
 * request.
 */
export interface UserAttentionState {
  /** The request still open for the user; a newer request replaces it. */
  request: UserAttentionRequest | null
  /** Whether the user already responded to the open request with a click or key. */
  quiet: boolean
  /** The human-waiting decision the open request stands for, if any. */
  decisionId: string | undefined
}

interface TrayAttentionHost {
  /** Translates into the current interface language; read on every use because the language can change. */
  text(key: MessageKey, parameters?: MessageParameters): string
  showWindow(): void
  /** The main window; read on every use because it opens after startup and goes when it closes. */
  mainWindow(): Pick<BrowserWindow, 'flashFrame' | 'webContents'> | null
  tabs(): Pick<BrowserTabsManager, 'selectTabAndWait'> | null
  mcpServer(): Pick<McpHttpServer, 'recordAgentAnswer'> | null
  /** Runs a browser action from native UI and reports its failure to the shell; skipped until saved workspaces are up. */
  runNativeBrowserAction(action: string, callback: () => unknown): void
  checkForUpdates(): Promise<AppUpdateState>
  /** Quits, after asking first when downloads are in progress; the tray's Quit uses it. */
  requestQuit(): void
  /** The record of attention requests agents read; it lives as long as the app. */
  userAttentionLifecycle: Pick<UserAttentionLifecycle, 'acknowledge' | 'reconcile' | 'request' | 'supersede'>
  /** The open request; index.ts creates the record, and the shell, Home, the IPC handlers and agents read it too. */
  state: UserAttentionState
  agentPresenceSnapshot(): AgentPresenceSnapshot
  scheduleAgentPresencePublish(): void
  /** The current settings; read on every use because each committed update replaces the object. */
  settings(): AppSettings
  /** Replaces the runtime settings without saving them. */
  setSettings(value: AppSettings): void
  publishSettings(): void
  updateSettings(updates: Partial<AppSettings>): Promise<AppSettings>
}

function loadTrayIcon(path: string): NativeImage {
  const icon = nativeImage.createFromPath(path)
  if (icon.isEmpty()) throw new Error(`Tray icon could not be loaded: ${path}`)
  return icon
}

function compactAttentionReason(reason: string): string {
  const compact = reason.replace(/\s+/g, ' ').trim()
  return compact.length > 72 ? `${compact.slice(0, 69)}…` : compact
}

/**
 * The tray icon and its menu, and how an agent's request for the user's attention shows: a pulsing tray icon, a
 * flashing window frame, a system notification and the shell's needs-you state, until the user responds or the
 * request ends. The tray, its icons, the signal timers and the agent commands still running on pages, during which a
 * key or click is not a response, live here; the open request is the UserAttentionState record index.ts creates,
 * because other features read it.
 */
export function createTrayAttention(host: TrayAttentionHost): {
  setTrayContextMenu(): void
  shellUserAttention(): UserAttentionRequest | null
  userAttentionShown(workspaces: AgentPresenceSnapshot['workspaces']): boolean
  quietUserAttention(): void
  endUserAttention(options?: { disposition?: 'acknowledged' | 'dismissed'; keepPending?: boolean }): void
  reconcileUserAttention(state: BrowserState): void
  acknowledgeUserAttention(): void
  requestUserAttention(input: UserAttentionInput): Promise<UserAttentionRequest>
  userAttentionForAgents(): UserAttentionRequest | null
  openUserAttentionId(): string | null
  agentMovedOn(attentionId: string): void
  noteMcpTabActivity(activity: Pick<McpTabActivity, 'activityId' | 'phase'>): void
  createTray(): boolean
} {
  let tray: Tray | null = null
  let attentionRequestGeneration = 0
  let attentionPulseTimer: NodeJS.Timeout | null = null
  let attentionExpiryTimer: NodeJS.Timeout | null = null
  let attentionPulseOn = false
  let attentionNotification: Notification | null = null
  let trayIcon: NativeImage | null = null
  let trayAttentionIcon: NativeImage | null = null
  /** Agent commands still running on a page; a key or click during one is not a response. */
  const activeMcpActivities = new Set<string>()

  function setTrayContextMenu(): void {
    if (!tray || tray.isDestroyed()) return
    const contextMenu = Menu.buildFromTemplate([
      ...(host.state.request
        ? [
            { label: host.text('native.tray.attention', { reason: compactAttentionReason(host.state.request!.reason) }), enabled: false },
            {
              label: host.text('native.tray.showRequested'),
              click: () => {
                const requestedAttention = host.state.request
                const requestedTabId = requestedAttention?.tabId
                if (requestedAttention && requestedTabId) {
                  host.runNativeBrowserAction('show the requested tab', async () => {
                    await host.tabs()?.selectTabAndWait(requestedTabId)
                    if (host.state.request?.id !== requestedAttention.id) return
                    host.showWindow()
                    quietUserAttention()
                  })
                  return
                }
                host.showWindow()
                quietUserAttention()
              }
            },
            {
              label: host.text('native.tray.dismissAttention'),
              click: () => {
                // Dismissing leaves a decision open, so it is not an answer to one.
                if (host.state.request && !host.state.decisionId) host.mcpServer()?.recordAgentAnswer(host.state.request!.id, 'dismissed')
                endUserAttention({ disposition: 'dismissed' })
              }
            },
            { type: 'separator' as const }
          ]
        : []),
      { label: host.text('native.tray.show'), click: host.showWindow },
      {
        label: host.text('native.menu.checkUpdates'),
        click: () => {
          host.showWindow()
          host.mainWindow()?.webContents.send('updates:open')
          void host.checkForUpdates()
        }
      },
      { type: 'separator' },
      {
        label: host.text('native.tray.quit'),
        click: host.requestQuit
      }
    ])
    tray.setContextMenu(contextMenu)
  }

  function renderAttentionPulse(): void {
    if (!tray || tray.isDestroyed() || !trayIcon || !trayAttentionIcon) return
    attentionPulseOn = !attentionPulseOn
    tray.setImage(attentionPulseOn ? trayAttentionIcon : trayIcon)
  }

  /** The open request as the shell shows it, marked when it belongs to a human-waiting decision. */
  function shellUserAttention(): UserAttentionRequest | null {
    if (!host.state.request) return null
    return { ...host.state.request!, ...(host.state.decisionId ? { humanWaitingDecisionId: host.state.decisionId } : {}) }
  }

  function stopAttentionSignals(): void {
    attentionNotification?.close()
    attentionNotification = null
    if (attentionPulseTimer) clearInterval(attentionPulseTimer)
    attentionPulseTimer = null
    attentionPulseOn = false
    host.mainWindow()?.flashFrame(false)
    if (tray && !tray.isDestroyed() && trayIcon) tray.setImage(trayIcon)
  }

  /** Whether an agent's avatar shows the open request, so that its card can answer it. */
  function userAttentionShown(workspaces: AgentPresenceSnapshot['workspaces']): boolean {
    const workspaceId = host.state.request?.workspaceId
    return Boolean(workspaceId && workspaces[workspaceId]?.some((agent) => agent.state === 'needs-you'))
  }

  /**
   * The user responded with a click or key: stop the pulse, flash and notification, and let agents
   * see the request as answered. It still shows as needs you until it is answered or ends; without an
   * avatar whose card can answer it, the response ends it, as it always did.
   */
  function quietUserAttention(): void {
    if (!host.state.request || host.state.quiet) return
    if (!userAttentionShown(host.agentPresenceSnapshot().workspaces)) {
      endUserAttention()
      return
    }
    host.state.quiet = true
    host.userAttentionLifecycle.acknowledge(host.state.request!.id, 'acknowledged')
    stopAttentionSignals()
  }

  /**
   * The request ended: answered, dismissed, expired, replaced, or its tab, workspace or decision is gone.
   * keepPending leaves another agent's request that is still waiting for its tab to wake to arrive,
   * for an end that is about this request alone.
   */
  function endUserAttention(options: { disposition?: 'acknowledged' | 'dismissed'; keepPending?: boolean } = {}): void {
    if (host.state.request) host.userAttentionLifecycle.acknowledge(host.state.request!.id, options.disposition ?? 'acknowledged')
    if (!options.keepPending) attentionRequestGeneration += 1
    host.state.decisionId = undefined
    host.state.quiet = false
    if (attentionExpiryTimer) clearTimeout(attentionExpiryTimer)
    attentionExpiryTimer = null
    attentionNotification?.close()
    attentionNotification = null
    if (!host.state.request && !attentionPulseTimer) return
    host.state.request = null
    if (host.mainWindow() && !host.mainWindow()!.webContents.isDestroyed()) host.mainWindow()!.webContents.send('attention:changed', null)
    host.scheduleAgentPresencePublish()
    stopAttentionSignals()
    if (tray && !tray.isDestroyed()) {
      tray.setToolTip('Hronaut')
      setTrayContextMenu()
    }
  }

  function reconcileUserAttention(state: BrowserState): void {
    host.userAttentionLifecycle.reconcile(state.tabs, state.mcpTabGroups.map(workspace => workspace.id))
    const request = host.state.request
    if (!request) return
    const workspaceExists = !request.workspaceId
      || state.mcpTabGroups.some((workspace) => workspace.id === request.workspaceId)
    const requestedTab = request.tabId
      ? state.tabs.find((tab) => tab.id === request.tabId)
      : undefined
    const tabExistsInTargetWorkspace = !request.tabId
      || Boolean(requestedTab && (!request.workspaceId || requestedTab.mcpGroupId === request.workspaceId))
    if (!workspaceExists || !tabExistsInTargetWorkspace) endUserAttention()
  }

  function acknowledgeUserAttention(): void {
    if (activeMcpActivities.size === 0) quietUserAttention()
  }

  /** An agent command started or settled on a page, as the MCP server reports its tab activity. */
  function noteMcpTabActivity(activity: Pick<McpTabActivity, 'activityId' | 'phase'>): void {
    if (activity.phase === 'started') activeMcpActivities.add(activity.activityId)
    else activeMcpActivities.delete(activity.activityId)
  }

  async function requestUserAttention(input: UserAttentionInput): Promise<UserAttentionRequest> {
    const requestGeneration = ++attentionRequestGeneration
    const request: UserAttentionRequest = {
      id: randomUUID(),
      reason: input.reason.replace(/\s+/g, ' ').trim(),
      ...(input.notificationMessage && { notificationMessage: input.notificationMessage.replace(/\s+/g, ' ').trim() }),
      requestedAt: new Date().toISOString(),
      ...(input.workspaceId && { workspaceId: input.workspaceId }),
      ...(input.tabId && { tabId: input.tabId })
    }
    if (input.tabId) await host.tabs()?.selectTabAndWait(input.tabId, { focus: false })
    if (requestGeneration !== attentionRequestGeneration) {
      throw new Error('User attention request was superseded by a newer request.')
    }
    if (input.expiresAt !== undefined && (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Date.now())) throw new Error('User attention request expired')
    if (input.workspaceId && !input.humanWaitingDecisionId) host.userAttentionLifecycle.request(request)
    else host.userAttentionLifecycle.supersede()
    host.state.request = request
    host.state.quiet = false
    host.state.decisionId = input.humanWaitingDecisionId
    attentionNotification?.close()
    attentionNotification = null
    if (host.mainWindow() && !host.mainWindow()!.webContents.isDestroyed()) host.mainWindow()!.webContents.send('attention:changed', shellUserAttention())
    host.scheduleAgentPresencePublish()
    if (attentionExpiryTimer) clearTimeout(attentionExpiryTimer)
    attentionExpiryTimer = null
    const attentionExpiresAt = input.expiresAt ?? (input.workspaceId && !input.humanWaitingDecisionId ? Date.now() + 86_400_000 : undefined)
    if (attentionExpiresAt !== undefined) {
      attentionExpiryTimer = setTimeout(() => {
        if (host.state.request?.id === request.id) endUserAttention({ keepPending: true })
      }, Math.min(86_400_000, Math.max(1, attentionExpiresAt - Date.now())))
      attentionExpiryTimer.unref()
    }
    if (attentionPulseTimer) clearInterval(attentionPulseTimer)
    attentionPulseTimer = setInterval(renderAttentionPulse, 650)
    attentionPulseTimer.unref()
    attentionPulseOn = false
    renderAttentionPulse()
    host.mainWindow()?.flashFrame(true)
    if (tray && !tray.isDestroyed()) {
      tray.setToolTip(host.text('native.tray.tooltipAttention', { reason: compactAttentionReason(request.reason) }))
      setTrayContextMenu()
    }
    if (host.mainWindow() && !host.mainWindow()!.webContents.isDestroyed()) {
      host.mainWindow()!.webContents.send('attention:requested')
    }
    if (Notification.isSupported()) {
      try {
        const notification = new Notification({ title: 'Hronaut', body: request.notificationMessage || request.reason })
        attentionNotification = notification
        notification.on('click', () => {
          if (host.state.request?.id !== request.id) return
          host.runNativeBrowserAction('show the requested tab', async () => {
            if (request.tabId) await host.tabs()?.selectTabAndWait(request.tabId)
            if (host.state.request?.id !== request.id) return
            host.showWindow()
            quietUserAttention()
          })
        })
        notification.show()
      } catch (error) {
        console.error('[attention] Failed to show system notification:', error)
      }
    }
    return { ...request }
  }

  /** The request agents see in status and preflight, as a copy: open and not yet answered by a click or key. */
  function userAttentionForAgents(): UserAttentionRequest | null {
    return host.state.request && !host.state.quiet ? { ...host.state.request } : null
  }

  /** The id of the request still open for the user, which agents see as needs you even once it is quiet. */
  function openUserAttentionId(): string | null {
    return host.state.request?.id ?? null
  }

  /** The agent that asked for the open plain request acted on a page in its workspace again. */
  function agentMovedOn(attentionId: string): void {
    // After the user responded, the agent acting again on a page ends its own request.
    if (host.state.request?.id === attentionId && host.state.quiet && !host.state.decisionId) endUserAttention({ keepPending: true })
  }

  function createTray(): boolean {
    if (tray && !tray.isDestroyed()) return true
    try {
      if (
        process.env.HRONAUT_INTEGRATION_TEST_HOOKS === '1'
        && process.env.HRONAUT_TEST_TRAY_CREATION_FAILURE === '1'
      ) throw new Error('Simulated tray creation failure')
      trayIcon = loadTrayIcon(trayIconPath)
      trayAttentionIcon = loadTrayIcon(trayAttentionIconPath)
      tray = new Tray(trayIcon)
      tray.setToolTip('Hronaut')
      setTrayContextMenu()
      bindTrayActivation(tray, host.showWindow, process.platform)
      return true
    } catch (error) {
      if (tray && !tray.isDestroyed()) tray.destroy()
      tray = null
      console.error('[tray] Failed to create tray:', error)
      if (host.settings().hideInTray) {
        host.setSettings({ ...host.settings(), hideInTray: false })
        host.publishSettings()
        void host.updateSettings({ hideInTray: false }).catch((saveError) =>
          console.error('[tray] Failed to disable hide-in-tray after tray creation failed:', saveError)
        )
      }
      return false
    }
  }

  return {
    setTrayContextMenu,
    shellUserAttention,
    userAttentionShown,
    quietUserAttention,
    endUserAttention,
    reconcileUserAttention,
    acknowledgeUserAttention,
    requestUserAttention,
    userAttentionForAgents,
    openUserAttentionId,
    agentMovedOn,
    noteMcpTabActivity,
    createTray
  }
}

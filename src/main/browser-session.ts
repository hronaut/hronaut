import { app, session, type MessageBoxOptions, type MessageBoxReturnValue, type Session } from 'electron'
import { join } from 'node:path'
import { flushBrowserSessionStorage } from './browser/workspace-storage.js'
import { isHronautHomeUrl } from '../shared/home-url.js'
import { normalizeSitePermissionOrigin, SitePermissionStore } from './site-permission-store.js'
import type { MessageKey, MessageParameters } from '../shared/i18n.js'
import type { SitePermissionDecision } from '../shared/types.js'

/**
 * The profile's persistent browser session and the site permissions the person chose, created once by index.ts and
 * opened by startup. Download settings, Home, the permissions IPC, browsing data, the panel snapshot and shutdown read
 * the fields when they run, so they always see the open session and store.
 */
export interface BrowserSessionState {
  /** The profile's persistent browser session, once open. */
  persistentSession: Session | null
  /** The site permissions the person chose, once open. */
  sitePermissionStore: SitePermissionStore | null
}

interface BrowserSessionHost {
  /** Translates into the current interface language; read on every use because the language can change. */
  text(key: MessageKey, parameters?: MessageParameters): string
  /** The download folder the current settings choose; read whenever a session is configured. */
  effectiveDownloadDirectory(): string
  /** Asks on the main window, or on its own while there is none. */
  showMessageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue>
  /** The persistent session and the site permissions; index.ts creates the record, and other features read it too. */
  state: BrowserSessionState
  publishSitePermissions(): void
  /** The partition of the profile's persistent browser session. */
  partition: string
}

/**
 * The browser sessions pages run in: each gets the download folder, a permission check that admits only what the
 * person allowed for the site, and a permission prompt that asks one request at a time and refuses a request whose
 * frame navigated meanwhile. Camera, microphone and file system access always ask again. Home never gets a
 * permission. `configurePersistentSession` opens the remembered site permissions and the profile's own session, and
 * `flushBrowserProfile` writes that session's storage to disk at shutdown.
 */
export function createBrowserSession(host: BrowserSessionHost): {
  configureBrowserSession(browserSession: Session): void
  configurePersistentSession(): Promise<void>
  flushBrowserProfile(): Promise<void>
} {
  const configuredBrowserSessions = new WeakSet<Session>()
  let permissionRequestQueue: Promise<void> = Promise.resolve()

  function queuePermissionRequest(operation: () => Promise<void>): void {
    const pending = permissionRequestQueue.then(operation)
    permissionRequestQueue = pending.catch(() => undefined)
  }

  function configureBrowserSession(browserSession: Session): void {
    if (configuredBrowserSessions.has(browserSession)) return
    configuredBrowserSessions.add(browserSession)
    browserSession.setDownloadPath(host.effectiveDownloadDirectory())
    browserSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
      const requestingUrl = details.requestingUrl || details.securityOrigin || requestingOrigin
      const origin =
        normalizeSitePermissionOrigin(requestingOrigin) ??
        normalizeSitePermissionOrigin(details.securityOrigin || '') ??
        normalizeSitePermissionOrigin(requestingUrl)
      if (permission === 'media' || permission === 'fileSystem') return false
      return Boolean(origin && host.state.sitePermissionStore?.get(origin, permission) === 'allow')
    })
    browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      let responded = false
      const respond = (allowed: boolean): void => {
        if (responded) return
        responded = true
        callback(allowed)
      }
      const requestingUrl = details.requestingUrl || webContents.getURL()
      if (isHronautHomeUrl(requestingUrl)) {
        respond(false)
        return
      }
      const origin = normalizeSitePermissionOrigin(requestingUrl)
      if (!origin) {
        respond(false)
        return
      }
      const requiresFreshConsent = permission === 'media' || permission === 'fileSystem'
      const remembered = requiresFreshConsent ? undefined : host.state.sitePermissionStore?.get(origin, permission)
      if (remembered) {
        respond(remembered === 'allow')
        return
      }
      const requestingFrameTreeNodeId = (() => {
        if (webContents.isDestroyed()) return null
        if (details.isMainFrame) return webContents.mainFrame.frameTreeNodeId
        const matchingFrames = webContents.mainFrame.framesInSubtree.filter(
          (frame) => !frame.detached && frame.url === requestingUrl
        )
        return matchingFrames.length === 1 ? matchingFrames[0]?.frameTreeNodeId ?? null : null
      })()
      if (requestingFrameTreeNodeId === null) {
        respond(false)
        return
      }
      const currentRequestOrigin = (): string | null => webContents.isDestroyed()
        ? null
        : normalizeSitePermissionOrigin(webContents.mainFrame.framesInSubtree.find(
          (frame) => frame.frameTreeNodeId === requestingFrameTreeNodeId && !frame.detached
        )?.url ?? '')
      const permissionDetail = (() => {
        if (permission === 'media' && 'mediaTypes' in details) {
          const types = details.mediaTypes?.map((type) => host.text(type === 'video' ? 'native.dialog.camera' : 'native.dialog.microphone')) ?? []
          return types.length
            ? host.text('native.dialog.requestedDevices', { devices: types.join(host.text('native.dialog.and')) })
            : host.text('native.dialog.devicesUnknown')
        }
        if (permission === 'fileSystem' && 'filePath' in details) {
          const access = details.fileAccessType ?? host.text('native.dialog.unspecifiedAccess')
          return host.text('native.dialog.requestedFile', { access, path: details.filePath || host.text('native.dialog.unspecifiedPath') })
        }
        return host.text('native.dialog.permissionRemember')
      })()
      queuePermissionRequest(async () => {
        try {
          if (currentRequestOrigin() !== origin) {
            respond(false)
            return
          }
          const currentRemembered = requiresFreshConsent ? undefined : host.state.sitePermissionStore?.get(origin, permission)
          if (currentRemembered) {
            respond(currentRemembered === 'allow')
            return
          }
          const { response } = await host.showMessageBox({
            type: 'question',
            title: host.text('native.dialog.sitePermission'),
            message: host.text('native.dialog.permissionRequest', { origin, permission }),
            detail: requiresFreshConsent
              ? host.text('native.dialog.permissionAskAgain', { detail: permissionDetail })
              : host.text('native.dialog.permissionSettings', { detail: permissionDetail }),
            buttons: [host.text('native.dialog.deny'), host.text('native.dialog.allow')],
            defaultId: 0,
            cancelId: 0
          })
          if (currentRequestOrigin() !== origin) {
            respond(false)
            return
          }
          const decision: SitePermissionDecision = response === 1 ? 'allow' : 'deny'
          try {
            if (!requiresFreshConsent) {
              await host.state.sitePermissionStore?.set(origin, permission, decision)
              host.publishSitePermissions()
            }
          } catch (error) {
            console.error('[permissions] Failed to persist site permission:', error)
          }
          respond(decision === 'allow')
        } catch {
          respond(false)
        }
      })
    })
  }

  async function configurePersistentSession(): Promise<void> {
    host.state.sitePermissionStore = new SitePermissionStore(join(app.getPath('userData'), 'site-permissions.json'))
    await host.state.sitePermissionStore!.load()
    host.state.persistentSession = session.fromPartition(host.partition, { cache: true })
    configureBrowserSession(host.state.persistentSession!)
  }

  async function flushBrowserProfile(): Promise<void> {
    if (!host.state.persistentSession) return
    await flushBrowserSessionStorage(host.state.persistentSession)
  }

  return { configureBrowserSession, configurePersistentSession, flushBrowserProfile }
}

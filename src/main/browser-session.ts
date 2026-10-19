import { app, session, type MessageBoxOptions, type MessageBoxReturnValue, type Session, type WebContents } from 'electron'
import { join } from 'node:path'
import { flushBrowserSessionStorage } from './browser/workspace-storage.js'
import { isHronautHomeUrl } from '../shared/home-url.js'
import { normalizeSitePermissionOrigin, SitePermissionStore } from './site-permission-store.js'
import type { MessageKey, MessageParameters } from '../shared/i18n.js'
import { sitePermissionName } from '../shared/site-permission-names.js'
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
  sendToShellWindows(channel: string, ...args: unknown[]): void
  /** The partition of the profile's persistent browser session. */
  partition: string
}

/**
 * Permissions Hronaut never remembers: camera and microphone, file access and opening a link in another app ask every
 * time, and a decision an earlier version saved for one of them is not used.
 */
const FRESH_CONSENT_PERMISSIONS: ReadonlySet<string> = new Set(['media', 'fileSystem', 'openExternal'])

/**
 * The website a document's permissions belong to: the HTTP or HTTPS origin the document runs as, which `documentOrigin`
 * (the frame's real origin) gives. An about:blank or about:srcdoc document runs as the origin of the page that made it,
 * and a blob: address names the origin that made it. A document whose address names another origin than the one it runs
 * as, such as a sandboxed frame running as the opaque origin "null", gets none.
 */
function documentPermissionOrigin(documentUrl: string, documentOrigin: string): string | null {
  const origin = normalizeSitePermissionOrigin(documentOrigin)
  if (!origin) return null
  let url: URL
  try {
    url = new URL(documentUrl)
  } catch {
    return null
  }
  if (url.protocol === 'about:') return url.pathname === 'blank' || url.pathname === 'srcdoc' ? origin : null
  return normalizeSitePermissionOrigin(url.protocol === 'blob:' ? url.origin : url.href) === origin ? origin : null
}

/**
 * What one page asked for. Each frame's document has a number, renewed when the frame loads another document, so a
 * request belongs to the document that made it. A prompt waiting or showing gives its answer to every identical request
 * from that document, and a request for a permission Hronaut never remembers that the person denied is refused without
 * asking again until its frame loads another document.
 */
interface PagePermissionRequests {
  /** The number of each frame's document, for a frame that loaded a document since the page first asked. */
  frameDocuments: Map<number, number>
  /** The number of every other frame's document; renewed when the main frame loads another document. */
  pageDocument: number
  /** The answer each prompt waiting or showing will give, by request. */
  prompts: Map<string, Promise<boolean>>
  /** The requests for a permission Hronaut never remembers that the person denied. */
  denied: Set<string>
}

/**
 * The browser sessions pages run in: each gets the download folder, a permission check that admits only what the
 * person allowed for the site, and a permission prompt that asks one request at a time, shows identical requests one
 * prompt and refuses a request whose frame loaded another document meanwhile. Camera, microphone, file system access and
 * opening a link in another app always ask again, unless the person denied the same request for the same document, and
 * screen sharing is refused without asking. Home never gets a permission. `configurePersistentSession` opens the
 * remembered site permissions and the profile's own session, `publishSitePermissions` tells both shell windows the
 * remembered permissions, and `flushBrowserProfile` writes that session's storage to disk at shutdown.
 */
export function createBrowserSession(host: BrowserSessionHost): {
  configureBrowserSession(browserSession: Session): void
  configurePersistentSession(): Promise<void>
  publishSitePermissions(): void
  flushBrowserProfile(): Promise<void>
} {
  const configuredBrowserSessions = new WeakSet<Session>()
  let permissionRequestQueue: Promise<void> = Promise.resolve()
  const pagePermissionRequests = new WeakMap<WebContents, PagePermissionRequests>()
  let documentCount = 0

  function queuePermissionRequest(operation: () => Promise<void>): void {
    const pending = permissionRequestQueue.then(operation)
    permissionRequestQueue = pending.catch(() => undefined)
  }

  /** The requests of one page, which starts following the documents its frames load when the page first asks. */
  function permissionRequestsOf(webContents: WebContents): PagePermissionRequests {
    const known = pagePermissionRequests.get(webContents)
    if (known) return known
    const page: PagePermissionRequests = { frameDocuments: new Map(), pageDocument: ++documentCount, prompts: new Map(), denied: new Set() }
    pagePermissionRequests.set(webContents, page)
    webContents.on('did-frame-navigate', (_event, _url, _httpResponseCode, _httpStatusText, isMainFrame, frameProcessId, frameRoutingId) => {
      const frame = isMainFrame || webContents.isDestroyed()
        ? undefined
        : webContents.mainFrame.framesInSubtree.find((candidate) => candidate.processId === frameProcessId && candidate.routingId === frameRoutingId)
      if (!frame) {
        // A new page replaces every frame. A frame that cannot be found may be any of them.
        page.frameDocuments.clear()
        page.pageDocument = ++documentCount
        page.denied.clear()
        return
      }
      page.frameDocuments.set(frame.frameTreeNodeId, ++documentCount)
      for (const request of page.denied) {
        if (request.startsWith(`${frame.frameTreeNodeId}\u0000`)) page.denied.delete(request)
      }
    })
    webContents.once('destroyed', () => pagePermissionRequests.delete(webContents))
    return page
  }

  function configureBrowserSession(browserSession: Session): void {
    if (configuredBrowserSessions.has(browserSession)) return
    configuredBrowserSessions.add(browserSession)
    browserSession.setDownloadPath(host.effectiveDownloadDirectory())
    browserSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
      if (FRESH_CONSENT_PERMISSIONS.has(permission)) return false
      // Electron gives the checking document's real origin, so an about:blank, about:srcdoc or blob: document resolves
      // to the same website here as its requests do.
      const documentOrigin = requestingOrigin || details.securityOrigin || ''
      const origin = documentPermissionOrigin(details.requestingUrl || documentOrigin, documentOrigin)
      return Boolean(origin && host.state.sitePermissionStore?.get(origin, permission) === 'allow')
    })
    browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      let responded = false
      const respond = (allowed: boolean): void => {
        if (responded) return
        responded = true
        callback(allowed)
      }
      if (webContents.isDestroyed()) {
        respond(false)
        return
      }
      const requestingUrl = details.requestingUrl || webContents.getURL()
      if (isHronautHomeUrl(requestingUrl)) {
        respond(false)
        return
      }
      // Electron names a requesting frame only by the address it shows, which several frames can share, such as two
      // about:blank frames. Their website is known when they all run as one origin; a prompt also needs the one frame.
      const mainFrameTreeNodeId = webContents.mainFrame.frameTreeNodeId
      const requestingFrames = details.isMainFrame
        ? [webContents.mainFrame]
        : webContents.mainFrame.framesInSubtree.filter(
          (frame) => frame.frameTreeNodeId !== mainFrameTreeNodeId && !frame.detached && frame.url === requestingUrl
        )
      const frameOrigins = new Set(requestingFrames.map((frame) => documentPermissionOrigin(requestingUrl, frame.origin)))
      const origin = frameOrigins.size === 1 ? frameOrigins.values().next().value ?? null : null
      if (!origin) {
        respond(false)
        return
      }
      // A camera or microphone request lists its devices. One that lists neither asks to capture the screen, a window
      // or a tab, through getDisplayMedia or getUserMedia's chromeMediaSource, and the prompt could only call it
      // "Camera and microphone": an allowed desktop source shared the whole screen. Refuse it without asking.
      const mediaTypes = permission === 'media' && 'mediaTypes' in details ? details.mediaTypes ?? [] : []
      if (permission === 'media' && mediaTypes.length === 0) {
        respond(false)
        return
      }
      // A link to another app, such as zoommtg: or vscode:, is named by its scheme alone: the rest can carry tokens.
      const externalScheme = (() => {
        if (permission !== 'openExternal' || !('externalURL' in details) || !details.externalURL) return null
        try {
          return new URL(details.externalURL).protocol
        } catch {
          return null
        }
      })()
      if (permission === 'openExternal' && !externalScheme) {
        respond(false)
        return
      }
      const requiresFreshConsent = FRESH_CONSENT_PERMISSIONS.has(permission)
      const remembered = requiresFreshConsent ? undefined : host.state.sitePermissionStore?.get(origin, permission)
      if (remembered) {
        respond(remembered === 'allow')
        return
      }
      const requestingFrame = requestingFrames.length === 1 ? requestingFrames[0]! : null
      if (!requestingFrame) {
        respond(false)
        return
      }
      const frameTreeNodeId = requestingFrame.frameTreeNodeId
      const page = permissionRequestsOf(webContents)
      const document = page.frameDocuments.get(frameTreeNodeId) ?? page.pageDocument
      // Two requests are identical when the same document asks for the same thing, so one prompt answers both.
      const scope = permission === 'media'
        ? [...mediaTypes].sort().join(' ')
        : permission === 'fileSystem' && 'filePath' in details
          ? `${details.fileAccessType ?? ''}\u0000${details.filePath ?? ''}`
          : externalScheme ?? ''
      const request = [frameTreeNodeId, document, origin, permission, scope].join('\u0000')
      if (page.denied.has(request)) {
        respond(false)
        return
      }
      const waiting = page.prompts.get(request)
      if (waiting) {
        void waiting.then(respond)
        return
      }
      const requestIsCurrent = (): boolean => {
        if (webContents.isDestroyed() || (page.frameDocuments.get(frameTreeNodeId) ?? page.pageDocument) !== document) return false
        const frame = webContents.mainFrame.framesInSubtree.find(
          (candidate) => candidate.frameTreeNodeId === frameTreeNodeId && !candidate.detached
        )
        return Boolean(frame && documentPermissionOrigin(frame.url, frame.origin) === origin)
      }
      const permissionDetail = (() => {
        if (permission === 'media') {
          const types = mediaTypes.map((type) => host.text(type === 'video' ? 'native.dialog.camera' : 'native.dialog.microphone'))
          return host.text('native.dialog.requestedDevices', { devices: types.join(host.text('native.dialog.and')) })
        }
        if (permission === 'fileSystem' && 'filePath' in details) {
          const access = host.text(details.fileAccessType === 'readable'
            ? 'native.dialog.fileReadAccess'
            : details.fileAccessType === 'writable' ? 'native.dialog.fileWriteAccess' : 'native.dialog.unspecifiedAccess')
          return host.text('native.dialog.requestedFile', { access, path: details.filePath || host.text('native.dialog.unspecifiedPath') })
        }
        if (externalScheme) return host.text('native.dialog.requestedExternalApp', { scheme: externalScheme })
        return host.text('native.dialog.permissionRemember')
      })()
      const askPerson = async (): Promise<boolean> => {
        if (!requestIsCurrent()) return false
        const currentRemembered = requiresFreshConsent ? undefined : host.state.sitePermissionStore?.get(origin, permission)
        if (currentRemembered) return currentRemembered === 'allow'
        // A camera-only or microphone-only request names just that device, not both.
        const permissionName = mediaTypes.length > 0 && mediaTypes.every((type) => type === 'video')
          ? host.text('runtime.permissions.camera')
          : mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio')
            ? host.text('runtime.permissions.microphone')
            : sitePermissionName(permission, (key) => host.text(key))
        const { response } = await host.showMessageBox({
          type: 'question',
          title: host.text('native.dialog.sitePermission'),
          message: host.text('native.dialog.permissionRequest', { origin, permission: permissionName }),
          detail: requiresFreshConsent
            ? host.text('native.dialog.permissionAskAgain', { detail: permissionDetail })
            : host.text('native.dialog.permissionSettings', { detail: permissionDetail }),
          buttons: [host.text('native.dialog.deny'), host.text('native.dialog.allow')],
          defaultId: 0,
          cancelId: 0
        })
        if (!requestIsCurrent()) return false
        const decision: SitePermissionDecision = response === 1 ? 'allow' : 'deny'
        if (requiresFreshConsent) {
          // Allow is never reused, but Deny holds for this document: a page that asks again at once, or many times,
          // is refused without another prompt until the frame loads another document, such as on reload.
          if (decision === 'deny') page.denied.add(request)
          return decision === 'allow'
        }
        try {
          await host.state.sitePermissionStore?.set(origin, permission, decision)
          publishSitePermissions()
        } catch (error) {
          console.error('[permissions] Failed to persist site permission:', error)
        }
        return decision === 'allow'
      }
      const answer = new Promise<boolean>((resolve) => {
        queuePermissionRequest(() => askPerson().then(resolve, () => resolve(false)))
      })
      page.prompts.set(request, answer)
      void answer.then((allowed) => {
        if (page.prompts.get(request) === answer) page.prompts.delete(request)
        respond(allowed)
      })
    })
  }

  async function configurePersistentSession(): Promise<void> {
    host.state.sitePermissionStore = new SitePermissionStore(join(app.getPath('userData'), 'site-permissions.json'))
    await host.state.sitePermissionStore!.load()
    host.state.persistentSession = session.fromPartition(host.partition, { cache: true })
    configureBrowserSession(host.state.persistentSession!)
  }

  /** Tells both shell windows the site permissions the person chose. */
  function publishSitePermissions(): void {
    host.sendToShellWindows('permissions:changed', host.state.sitePermissionStore?.list() ?? [])
  }

  async function flushBrowserProfile(): Promise<void> {
    if (!host.state.persistentSession) return
    await flushBrowserSessionStorage(host.state.persistentSession)
  }

  return { configureBrowserSession, configurePersistentSession, publishSitePermissions, flushBrowserProfile }
}

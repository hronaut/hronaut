import { app, session, type Session, type WebContents } from 'electron'
import { statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { flushBrowserSessionStorage } from './browser/workspace-storage.js'
import { isHronautHomeUrl } from '../shared/home-url.js'
import { FRESH_CONSENT_PERMISSIONS, normalizeSitePermissionOrigin, SitePermissionStore } from './site-permission-store.js'
import type { MessageKey, MessageParameters } from '../shared/i18n.js'
import { sitePermissionName } from '../shared/site-permission-names.js'
import type { SitePermissionDecision } from '../shared/types.js'
import type { SitePermissionDialogVariant } from '../shared/trusted-dialogs.js'
import type { TrustedDialogOptions } from './trusted-dialogs/trusted-dialogs.js'

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
  /**
   * Asks the person in Hronaut's own dialog over the main window's pages, where every tab is shown, or in the system
   * dialog while that window cannot show it; resolves with the chosen button as `dialog.showMessageBox` does.
   */
  showDialog(options: Omit<TrustedDialogOptions, 'window'>): Promise<{ response: number }>
  /** The open and archived workspaces, read when a permission prompt names the one it asks in. */
  workspaces(): ReadonlyArray<{ id: string, name: string }>
  /** The persistent session and the site permissions; index.ts creates the record, and other features read it too. */
  state: BrowserSessionState
  sendToShellWindows(channel: string, ...args: unknown[]): void
  /** The partition of the profile's persistent browser session. */
  partition: string
  /** Whether the person turned on letting websites save to any single file they hold; read on every check. */
  websitesMaySaveFiles(): boolean
  /** Has the session check spelling as the spell check setting says, now and after every change. */
  trackSpellCheck(browserSession: Session): void
}

/**
 * A workspace's name as a permission prompt shows it, or undefined for a workspace Hronaut does not know. Hronaut keeps
 * names plain (see `plainWorkspaceName`), so an agent's name cannot add a paragraph to the prompt or reverse its words;
 * and when another workspace reads the same, such as the person's own, it ends with part of its id, as Settings shows it.
 */
export function promptWorkspaceName(workspaceId: string, workspaces: ReadonlyArray<{ id: string, name: string }>): string | undefined {
  // Joiners, direction marks and runs of spaces do not change how a name reads, nor a letter and its accent written
  // apart, which they could keep apart.
  const reading = (name: string): string => name.replace(/[\u200C-\u200F\u061C]/gu, '').normalize('NFC').replace(/\s+/gu, ' ')
  const own = workspaces.find((workspace) => workspace.id === workspaceId)
  const name = own?.name ?? ''
  if (!own || !name) return undefined
  const readsAlike = workspaces.some((workspace) => workspace.id !== workspaceId && reading(workspace.name) === reading(own.name))
  return readsAlike ? `${name} · ${workspaceId.replaceAll('-', '').slice(-6)}` : name
}

/** The most characters of a link's scheme a prompt shows; a page chooses the scheme, so it can be very long. */
const SHOWN_SCHEME_LENGTH = 64
/** A link's scheme as a prompt shows it. */
function shownScheme(scheme: string): string {
  return scheme.length > SHOWN_SCHEME_LENGTH ? `${scheme.slice(0, SHOWN_SCHEME_LENGTH - 1)}…` : scheme
}
/** How often a permission prompt checks that the frame that asked is still there, since Electron reports no removed frame. */
const STALE_PROMPT_CHECK_MS = 500

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
 * The website a requester at `origin` is embedded in: the website of the page's main frame, resolved as its documents'
 * are, when it is another website. The page's own website, in its main frame or in any of its frames, is embedded in
 * none. A page whose website cannot be known, or that is gone, gives null: its frames get no permission, since neither
 * another page's decision nor the website's own may stand in for it.
 */
function embeddingSiteOf(webContents: WebContents, origin: string, isMainFrame: boolean): string | undefined | null {
  if (isMainFrame) return undefined
  if (webContents.isDestroyed()) return null
  const mainFrame = webContents.mainFrame
  const pageOrigin = documentPermissionOrigin(mainFrame.url, mainFrame.origin)
  if (!pageOrigin) return null
  return pageOrigin === origin ? undefined : pageOrigin
}

/**
 * The website a check without a page names as the page around its requester, such as a storage-access check Chromium
 * makes for an embedded website: none when it names none or the requester's own website, and null when it names
 * something that is not an HTTP or HTTPS website, which gets no permission.
 */
function namedEmbeddingSite(embeddingOrigin: string | undefined, origin: string): string | undefined | null {
  if (embeddingOrigin === undefined) return undefined
  const site = normalizeSitePermissionOrigin(embeddingOrigin)
  if (!site) return null
  return site === origin ? undefined : site
}

/**
 * What one page asked for. The page's document and each frame's have a number: the page's is renewed when the main
 * frame loads another document, and a frame's when that frame does, so a request belongs to the document that made it.
 * A prompt waiting or showing gives its answer to every identical request from the same frame's document. A Deny for a
 * permission Hronaut never remembers holds for the page's document: the same request from any of its frames that runs
 * as the same website, including a frame that loads again or a new one, is refused without asking until the main frame
 * loads another document. An Allow for one also holds for that document, but only for what Chromium checks: the page's
 * camera and microphone devices, and writing a file or folder the website holds. Every request still asks.
 */
interface PagePermissionRequests {
  /** The number of the main frame's document; every Deny holds until it is renewed. */
  pageDocument: number
  /** The number of each frame's document, for a frame that loaded one since the page's; any other frame's is the page's. */
  frameDocuments: Map<number, number>
  /** The answer each prompt waiting or showing will give, by frame document and request. */
  prompts: Map<string, Promise<boolean>>
  /** The requests the person denied for the page's document, by page document, website, permission and scope. */
  denied: Set<string>
  /** What the person allowed for the page's document, by page document, website, permission and scope. */
  allowed: Set<string>
}

/** How long after a website's Save dialog empties the file the person picked Hronaut still takes it for that file. */
const SAVE_DIALOG_FILE_MS = 60_000

/** How many single files Hronaut remembers a session's websites using; a file beyond them is taken for one you opened. */
const MAX_FILE_USES = 10_000

/**
 * When a website's Save dialog emptied a file, if it may have just done so. Chromium creates the file the person picked,
 * or empties it after they agreed to replace it, before Hronaut is asked anything, and then asks only the permission
 * check whether the website may write it: it is a regular file with nothing in it, changed moments ago. A file with
 * anything in it never is, so this never lets a website change what a file holds.
 */
function emptiedBySaveDialogAt(path: string, now: number): number | undefined {
  if (!isAbsolute(path)) return undefined
  try {
    const file = statSync(path, { throwIfNoEntry: false })
    return file?.isFile() && file.size === 0 && Math.abs(now - file.mtimeMs) <= SAVE_DIALOG_FILE_MS ? file.mtimeMs : undefined
  } catch {
    return undefined
  }
}

/** The key a Deny or an Allow for a permission Hronaut never remembers holds under for the page's document. */
function permissionHold(page: PagePermissionRequests, origin: string, permission: string, scope: string): string {
  return [page.pageDocument, origin, permission, scope].join('\u0000')
}

/**
 * The browser sessions pages run in: each gets the download folder, a permission check that admits only what the
 * person allowed for the site, and a permission prompt that asks one request at a time, shows identical requests one
 * prompt and refuses a request whose frame loaded another document meanwhile. A decision belongs to the workspace whose
 * session the page runs in and, for a website embedded in a page of another website, to that page's website, as
 * `SitePermissionStore.decisionFor` looks it up; a session no workspace claimed gets no permission. Camera, microphone,
 * file system access and every link to another app always ask again, unless the person denied the same request for the
 * same page document, and a check finds them allowed only as `freshConsentAllows` says. Screen sharing is refused
 * without asking. Home never gets a permission.
 * `configurePersistentSession` opens the remembered site permissions and the profile's own session,
 * `publishSitePermissions` tells both shell windows the remembered permissions, `forgetWorkspaceSitePermissions` forgets
 * the decisions of a workspace that is gone for good, `forgetRemovedWorkspacesSitePermissions` those of every workspace
 * that no longer exists, and `flushBrowserProfile` writes that session's storage to disk at shutdown.
 */
export function createBrowserSession(host: BrowserSessionHost): {
  configureBrowserSession(browserSession: Session, workspaceId?: string): void
  configurePersistentSession(): Promise<void>
  publishSitePermissions(): void
  forgetWorkspaceSitePermissions(workspaceId: string): Promise<void>
  forgetRemovedWorkspacesSitePermissions(currentWorkspaces: () => Iterable<string> | null): Promise<void>
  flushBrowserProfile(): Promise<void>
} {
  const configuredBrowserSessions = new WeakSet<Session>()
  /** The workspace each workspace session belongs to, or null for a session two workspaces claimed. */
  const sessionWorkspaces = new WeakMap<Session, string | null>()
  let permissionRequestQueue: Promise<void> = Promise.resolve()
  const pagePermissionRequests = new WeakMap<WebContents, PagePermissionRequests>()
  /** The pages with a file access Deny or Allow; Chromium checks a file it gave a website without naming the page. */
  const fileAccessPages = new Set<WebContents>()
  /**
   * The single files each session's websites read or asked to write, by website and path, until Hronaut quits: when the
   * file was empty and just changed the first time, as a Save dialog leaves it, the time it was changed; `saved` once the
   * website asked to write that same empty file; and `held` for any other file, such as one you opened in the website.
   */
  const fileUses = new WeakMap<Session, Map<string, number | 'saved' | 'held'>>()
  let documentCount = 0

  function queuePermissionRequest(operation: () => Promise<void>): void {
    const pending = permissionRequestQueue.then(operation)
    permissionRequestQueue = pending.catch(() => undefined)
  }

  /** The requests of one page, which starts following the documents its frames load when the page first asks. */
  function permissionRequestsOf(webContents: WebContents): PagePermissionRequests {
    const known = pagePermissionRequests.get(webContents)
    if (known) return known
    const page: PagePermissionRequests = { pageDocument: ++documentCount, frameDocuments: new Map(), prompts: new Map(), denied: new Set(), allowed: new Set() }
    pagePermissionRequests.set(webContents, page)
    webContents.on('did-frame-navigate', (_event, _url, _httpResponseCode, _httpStatusText, isMainFrame, frameProcessId, frameRoutingId) => {
      if (webContents.isDestroyed()) return
      const mainFrame = webContents.mainFrame
      const navigated = (frame: { processId: number, routingId: number }): boolean => (
        frame.processId === frameProcessId && frame.routingId === frameRoutingId
      )
      if (isMainFrame && navigated(mainFrame)) {
        // A new page replaces every frame and lifts every Deny and Allow.
        page.pageDocument = ++documentCount
        page.frameDocuments.clear()
        page.denied.clear()
        page.allowed.clear()
        return
      }
      // Electron also reports the main frame of a page that is not the one shown, such as one loading in the background.
      // A frame that cannot be found may be any of the page's frames, so none keeps its document, and every Deny holds.
      const frame = mainFrame.framesInSubtree.find(
        (candidate) => candidate.frameTreeNodeId !== mainFrame.frameTreeNodeId && navigated(candidate)
      )
      for (const renewed of frame ? [frame] : mainFrame.framesInSubtree) {
        page.frameDocuments.set(renewed.frameTreeNodeId, ++documentCount)
      }
    })
    webContents.once('destroyed', () => {
      pagePermissionRequests.delete(webContents)
      fileAccessPages.delete(webContents)
    })
    return page
  }

  /**
   * Whether a check for a permission Hronaut never remembers finds it allowed. Chromium asks the check, not what the
   * request answered, whether a page may still use what the person gave it: a page that got its camera or microphone
   * learns the devices' names and that access is allowed while it keeps its document. A file or folder the website
   * holds can be read, since only the person's pick or drop, or an Allow, hands one to it, and that includes a handle the
   * website stored and restores after a restart, unless the person denied reading it on a page of the website that keeps
   * that document; it can be written only while a page of the website keeps the document the person allowed writing it
   * for, and a single file also with the person's switch on, or as the file its Save dialog emptied, as below. A link to
   * another app is never allowed by a check.
   */
  function freshConsentAllows(
    browserSession: Session,
    webContents: WebContents | null,
    origin: string,
    permission: string,
    details: Electron.PermissionCheckHandlerHandlerDetails
  ): boolean {
    if (permission === 'media') {
      const page = webContents ? pagePermissionRequests.get(webContents) : undefined
      const { mediaType } = details
      return Boolean(page && (mediaType === 'video' || mediaType === 'audio') && page.allowed.has(permissionHold(page, origin, permission, mediaType)))
    }
    if (permission !== 'fileSystem' || !('fileAccessType' in details) || !('filePath' in details)) return false
    const access = details.fileAccessType
    if (access !== 'readable' && access !== 'writable') return false
    const filePath = typeof details.filePath === 'string' ? details.filePath : ''
    const scope = `${access}\u0000${filePath}`
    const singleFile = 'isDirectory' in details && details.isDirectory === false && filePath !== ''
    // Whether its Save dialog may have given the website a file shows the first time the website reads it or asks to
    // write it, so a file it read or asked to write before, such as one you opened in it, is never taken for one.
    const fileUse = [origin, filePath].join('\u0000')
    const uses = fileUses.get(browserSession) ?? new Map<string, number | 'saved' | 'held'>()
    if (singleFile && !uses.has(fileUse) && uses.size < MAX_FILE_USES) {
      uses.set(fileUse, emptiedBySaveDialogAt(filePath, Date.now()) ?? 'held')
      fileUses.set(browserSession, uses)
    }
    const pages = [...fileAccessPages]
      .filter((page) => !page.isDestroyed() && page.session === browserSession)
      .flatMap((page) => pagePermissionRequests.get(page) ?? [])
    if (pages.some((page) => page.denied.has(permissionHold(page, origin, permission, scope)))) return false
    if (access === 'readable' || pages.some((page) => page.allowed.has(permissionHold(page, origin, permission, scope)))) return true
    // A single file: the person's switch lets websites write every one they hold, which Electron cannot tell apart from
    // a file a rename would replace. Without it, only the file the website's Save dialog just emptied, as in Chrome.
    // Electron does not say that a check follows a Save dialog, so any empty file changed in the last minute counts, such
    // as one a rename would replace, since replacing an empty file loses nothing. The website keeps saving there only
    // when it first read or asked to write the file while it was so, and asks to write it before anything changes it:
    // its first save replaces the file only when it is done. Any other file can be written only while it is empty, as
    // one that another program saves in place is for a moment, before it holds the person's text again.
    if (!singleFile) return false
    if (host.websitesMaySaveFiles()) return true
    const use = uses.get(fileUse)
    if (use === 'saved') return true
    const emptiedAt = emptiedBySaveDialogAt(filePath, Date.now())
    if (emptiedAt === undefined) return false
    if (use === emptiedAt) uses.set(fileUse, 'saved')
    return true
  }

  /**
   * Gives a browser session its download folder, spell checking and permission handlers once. A tab's session also
   * names the workspace it belongs to, the one whose decisions its pages get; each workspace has its own session, so a
   * session that two workspaces claim gets no permission at all.
   */
  function configureBrowserSession(browserSession: Session, workspaceId?: string): void {
    if (workspaceId !== undefined) {
      const known = sessionWorkspaces.get(browserSession)
      sessionWorkspaces.set(browserSession, known === undefined || known === workspaceId ? workspaceId : null)
    }
    if (configuredBrowserSessions.has(browserSession)) return
    configuredBrowserSessions.add(browserSession)
    browserSession.setDownloadPath(host.effectiveDownloadDirectory())
    browserSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      const workspaceId = sessionWorkspaces.get(browserSession)
      if (!workspaceId) return false
      // Electron gives the checking document's real origin, so an about:blank, about:srcdoc or blob: document resolves
      // to the same website here as its requests do.
      const documentOrigin = requestingOrigin || details.securityOrigin || ''
      const origin = documentPermissionOrigin(details.requestingUrl || documentOrigin, documentOrigin)
      if (!origin) return false
      // A check without a page, such as a service worker's, is the website's own, unless it names the website it is
      // embedded in. A worker an embedded website starts is checked as that website's own, since Chromium gives only
      // the worker's origin, as in Chrome.
      const embeddedIn = webContents
        ? embeddingSiteOf(webContents, origin, details.isMainFrame)
        : namedEmbeddingSite(details.embeddingOrigin, origin)
      if (embeddedIn === null) return false
      if (FRESH_CONSENT_PERMISSIONS.has(permission)) return freshConsentAllows(browserSession, webContents, origin, permission, details)
      return host.state.sitePermissionStore?.decisionFor(origin, permission, workspaceId, embeddedIn) === 'allow'
    })
    browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      let responded = false
      const respond = (allowed: boolean): void => {
        if (responded) return
        responded = true
        callback(allowed)
      }
      // A page whose session no workspace claimed, such as Home's, has no decisions to use or keep.
      const workspaceId = sessionWorkspaces.get(browserSession)
      if (webContents.isDestroyed() || !workspaceId) {
        respond(false)
        return
      }
      // A request without the requesting frame's address cannot be tied to a website. Using the page's address instead
      // would give a frame the page's permissions, so it gets none.
      const requestingUrl = details.requestingUrl
      if (!requestingUrl || isHronautHomeUrl(requestingUrl)) {
        respond(false)
        return
      }
      // Electron names a requesting frame only by the address it shows, which several frames can share, such as two
      // about:blank frames. Their website is known when they all run as one origin; a prompt also needs the one frame.
      const mainFrame = webContents.mainFrame
      const frames = mainFrame.framesInSubtree
      const requestingFrames = details.isMainFrame
        ? [mainFrame]
        : frames.filter(
          (frame) => frame.frameTreeNodeId !== mainFrame.frameTreeNodeId && !frame.detached && frame.url === requestingUrl
        )
      const frameOrigins = new Set(requestingFrames.map((frame) => documentPermissionOrigin(requestingUrl, frame.origin)))
      const origin = frameOrigins.size === 1 ? frameOrigins.values().next().value ?? null : null
      // A website embedded in a page of another website asks as embedded in that page's website, the one its decision
      // belongs to.
      const embeddedIn = origin ? embeddingSiteOf(webContents, origin, details.isMainFrame) : null
      if (!origin || embeddedIn === null) {
        respond(false)
        return
      }
      const decisionScope = { workspaceId, ...(embeddedIn ? { embeddedIn } : {}) }
      // A camera or microphone request lists its devices. One that lists neither asks to capture the screen, a window
      // or a tab, through getDisplayMedia or getUserMedia's chromeMediaSource, and the prompt could only call it
      // "Camera and microphone": an allowed desktop source shared the whole screen. Refuse it without asking.
      const mediaTypes = permission === 'media' && 'mediaTypes' in details ? details.mediaTypes ?? [] : []
      if (permission === 'media' && mediaTypes.length === 0) {
        respond(false)
        return
      }
      // A link to another app, such as zoommtg: or vscode:, is shown by its scheme alone: the rest can carry tokens.
      const externalLink = (() => {
        if (permission !== 'openExternal' || !('externalURL' in details) || !details.externalURL) return null
        try {
          return { url: details.externalURL, scheme: new URL(details.externalURL).protocol }
        } catch {
          return null
        }
      })()
      if (permission === 'openExternal' && !externalLink) {
        respond(false)
        return
      }
      const requiresFreshConsent = FRESH_CONSENT_PERMISSIONS.has(permission)
      const remembered = requiresFreshConsent
        ? undefined
        : host.state.sitePermissionStore?.decisionFor(origin, permission, workspaceId, embeddedIn)
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
      // Forget the documents of frames that are gone, so a long-lived page that makes many frames does not grow this.
      const liveFrames = new Set(frames.map((frame) => frame.frameTreeNodeId))
      for (const knownFrame of page.frameDocuments.keys()) {
        if (!liveFrames.has(knownFrame)) page.frameDocuments.delete(knownFrame)
      }
      const document = page.frameDocuments.get(frameTreeNodeId) ?? page.pageDocument
      // What is asked for: the devices, the file and its access, or the link's scheme. A Deny holds for the same thing
      // asked by any of the page's frames that runs as the same website, so frames that ask at once or a frame that
      // loads again cannot ask after every refusal.
      const scope = permission === 'media'
        ? [...mediaTypes].sort().join(' ')
        : permission === 'fileSystem' && 'filePath' in details
          ? `${details.fileAccessType ?? ''}\u0000${details.filePath ?? ''}`
          : externalLink?.scheme ?? ''
      const hold = permissionHold(page, origin, permission, scope)
      if (page.denied.has(hold)) {
        respond(false)
        return
      }
      // One prompt answers identical requests from the same frame's document. Electron opens the link each answer
      // belongs to, so only the same link shares a prompt: one Allow must not open several different links.
      const request = [frameTreeNodeId, document, origin, permission, externalLink?.url ?? scope].join('\u0000')
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
        // The decision belongs to the website of the page around the frame, so that page must still be the same website.
        return Boolean(frame && documentPermissionOrigin(frame.url, frame.origin) === origin
          && embeddingSiteOf(webContents, origin, details.isMainFrame) === embeddedIn)
      }
      // What a request Hronaut never remembers asks for, or null when its permission says it all.
      const requestedDetail = (() => {
        if (permission === 'media') {
          const types = mediaTypes.map((type) => host.text(type === 'video' ? 'native.dialog.camera' : 'native.dialog.microphone'))
          return host.text('native.dialog.requestedDevices', { devices: types.join(host.text('native.dialog.and')) })
        }
        if (permission === 'fileSystem' && 'filePath' in details) {
          const access = host.text(details.fileAccessType === 'readable'
            ? 'native.dialog.fileReadAccess'
            : details.fileAccessType === 'writable' ? 'native.dialog.fileWriteAccess' : 'native.dialog.unspecifiedAccess')
          const requested = host.text('native.dialog.requestedFile', { access, path: details.filePath || host.text('native.dialog.unspecifiedPath') })
          // Chromium asks only the check before it reads or writes again: an Allow to read holds for every handle the website
          // keeps, even one it restores after a restart, and an Allow to write holds while this page keeps its document.
          const lasts = details.fileAccessType === 'readable' ? 'native.dialog.fileReadKeeps'
            : details.fileAccessType === 'writable' ? 'native.dialog.fileWriteUntilReload' : null
          return lasts ? `${requested} ${host.text(lasts)}` : requested
        }
        if (externalLink) {
          return host.text('native.dialog.requestedExternalApp', { scheme: shownScheme(externalLink.scheme) })
        }
        return null
      })()
      const askPerson = async (): Promise<boolean> => {
        // A Deny the person chose while this request waited holds for it too.
        if (!requestIsCurrent() || page.denied.has(hold)) return false
        const currentRemembered = requiresFreshConsent
          ? undefined
          : host.state.sitePermissionStore?.decisionFor(origin, permission, workspaceId, embeddedIn)
        if (currentRemembered) return currentRemembered === 'allow'
        // A camera-only or microphone-only request names just that device, not both.
        const permissionName = mediaTypes.length > 0 && mediaTypes.every((type) => type === 'video')
          ? host.text('runtime.permissions.camera')
          : mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio')
            ? host.text('runtime.permissions.microphone')
            : sitePermissionName(permission, (key) => host.text(key))
        // The decision belongs to the tab's workspace, and that tab may be in a workspace that is not shown, such as one
        // an agent works in, so the prompt names it. The name is read now, since the person can rename it meanwhile.
        const workspace = promptWorkspaceName(workspaceId, host.workspaces())
        // A request Hronaut never remembers does not say it remembers the choice, even with nothing else to say.
        const permissionDetail = requiresFreshConsent
          ? (workspace ? host.text('native.dialog.permissionAskedIn', { detail: requestedDetail ?? '', workspace }) : requestedDetail ?? '').trim()
          : embeddedIn
            ? workspace
              ? host.text('native.dialog.permissionRememberEmbeddedIn', { site: embeddedIn, workspace })
              : host.text('native.dialog.permissionRememberEmbedded', { site: embeddedIn })
            : workspace ? host.text('native.dialog.permissionRememberIn', { workspace }) : host.text('native.dialog.permissionRemember')
        // The prompt closes, as Deny would, once its tab closes, or the page or frame that asked loads another document,
        // an error page included, or is removed: its answer would no longer count, and every prompt after it waited for it,
        // as did the same page asking again. Electron reports no removed frame, so the prompt also checks while it shows.
        const promptClosing = new AbortController()
        const closeWhenStale = (): void => {
          if (!requestIsCurrent()) promptClosing.abort()
        }
        webContents.on('did-frame-navigate', closeWhenStale)
        webContents.on('did-fail-load', closeWhenStale)
        webContents.on('destroyed', closeWhenStale)
        const staleCheck = setInterval(closeWhenStale, STALE_PROMPT_CHECK_MS)
        staleCheck.unref()
        // What the shell draws: the same request, as data, so its dialog can name the device and the workspace itself.
        const variant: SitePermissionDialogVariant = {
          kind: 'site-permission',
          origin,
          ...(embeddedIn ? { embeddedIn } : {}),
          permission,
          ...(permission === 'media' ? { mediaTypes: [...mediaTypes] } : {}),
          ...(workspace ? { workspaceName: workspace } : {}),
          freshConsent: requiresFreshConsent,
          ...(permission === 'fileSystem' && 'filePath' in details
            ? { file: { path: details.filePath ?? '', access: details.fileAccessType === 'readable' || details.fileAccessType === 'writable' ? details.fileAccessType : 'unspecified' } }
            : {}),
          ...(externalLink ? { externalScheme: shownScheme(externalLink.scheme) } : {})
        }
        let response: number
        try {
          ({ response } = await host.showDialog({
            variant,
            signal: promptClosing.signal,
            type: 'question',
            title: host.text('native.dialog.sitePermission'),
            message: embeddedIn
              ? host.text('native.dialog.permissionRequestEmbedded', { origin, site: embeddedIn, permission: permissionName })
              : host.text('native.dialog.permissionRequest', { origin, permission: permissionName }),
            detail: requiresFreshConsent
              ? host.text('native.dialog.permissionAskAgain', { detail: permissionDetail }).trim()
              : host.text('native.dialog.permissionSettings', { detail: permissionDetail }),
            buttons: [host.text('native.dialog.deny'), host.text('native.dialog.allow')],
            // Enter, or a key still held from the page, refuses: Deny takes the focus and Allow is the main action.
            defaultId: 0,
            cancelId: 0,
            primaryId: 1
          }))
        } finally {
          clearInterval(staleCheck)
          webContents.removeListener('did-frame-navigate', closeWhenStale)
          webContents.removeListener('did-fail-load', closeWhenStale)
          webContents.removeListener('destroyed', closeWhenStale)
        }
        if (promptClosing.signal.aborted || !requestIsCurrent()) return false
        const decision: SitePermissionDecision = response === 1 ? 'allow' : 'deny'
        if (requiresFreshConsent) {
          // Allow is never reused, but Deny holds for the page's document: a page that asks again at once, or many
          // times, is refused without another prompt until the main frame loads another document, such as on reload.
          // An Allow holds for what Chromium checks afterwards: each device it gave and the file access.
          const answered = permission === 'media' ? mediaTypes.map((type) => permissionHold(page, origin, permission, type)) : [hold]
          if (decision === 'deny') {
            page.denied.add(hold)
            for (const allowed of answered) page.allowed.delete(allowed)
          } else if (permission !== 'openExternal') {
            for (const allowed of answered) page.allowed.add(allowed)
          }
          if (permission === 'fileSystem') fileAccessPages.add(webContents)
          return decision === 'allow'
        }
        try {
          await host.state.sitePermissionStore?.set(origin, permission, decision, decisionScope)
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
    browserSession.on('file-system-access-restricted', (_event, details, callback) => {
      answerProtectedLocation(browserSession, details, callback)
    })
    // After the permission handlers, so a session is never left configured without them.
    host.trackSpellCheck(browserSession)
  }

  /**
   * Answers Electron when a website's picker or a dropped folder gives it a location Chromium protects: a system
   * folder, Hronaut's own data, private keys such as ~/.ssh, or a whole personal folder such as the home or Documents
   * folder. Electron waits for the answer, and the website's picker never returned while nothing answered. Hronaut never
   * gives such a location: the person can choose another, which opens the picker again, or cancel, which refuses it.
   * Chromium refuses a dropped folder whatever the answer, since it has no picker to open again.
   */
  function answerProtectedLocation(
    browserSession: Session,
    details: Electron.FileSystemAccessRestrictedDetails,
    callback: (action: 'allow' | 'deny' | 'tryAgain') => void
  ): void {
    const { webContents, frame } = details
    const origin = normalizeSitePermissionOrigin(details.origin)
    if (!sessionWorkspaces.get(browserSession) || !webContents || webContents.isDestroyed() || !frame || frame.detached || !origin) {
      callback('deny')
      return
    }
    // The answer belongs to the document that asked. It no longer counts once its tab closes, or the page or the frame
    // that asked loads another document, an error page included, or is removed, even while it waits behind other prompts.
    const page = permissionRequestsOf(webContents)
    const frameTreeNodeId = frame.frameTreeNodeId
    const document = page.frameDocuments.get(frameTreeNodeId) ?? page.pageDocument
    const isCurrent = (): boolean => {
      if (webContents.isDestroyed() || (page.frameDocuments.get(frameTreeNodeId) ?? page.pageDocument) !== document) return false
      const asking = webContents.mainFrame.framesInSubtree.find(
        (candidate) => candidate.frameTreeNodeId === frameTreeNodeId && !candidate.detached
      )
      return Boolean(asking && documentPermissionOrigin(asking.url, asking.origin) === origin)
    }
    const kind = details.isDirectory ? 'Folder' : 'File'
    queuePermissionRequest(async () => {
      const closing = new AbortController()
      const closeWhenStale = (): void => {
        if (!isCurrent()) closing.abort()
      }
      let action: 'deny' | 'tryAgain' = 'deny'
      let staleCheck: ReturnType<typeof setInterval> | undefined
      try {
        if (!isCurrent()) return
        webContents.on('did-frame-navigate', closeWhenStale)
        webContents.on('did-fail-load', closeWhenStale)
        webContents.on('destroyed', closeWhenStale)
        // Electron reports no removed frame, so the prompt also checks while it shows.
        staleCheck = setInterval(closeWhenStale, STALE_PROMPT_CHECK_MS)
        staleCheck.unref()
        const { response } = await host.showDialog({
          variant: { kind: 'protected-file-access', origin, target: details.isDirectory ? 'folder' : 'file' },
          signal: closing.signal,
          type: 'warning',
          title: host.text('native.dialog.sitePermission'),
          message: host.text(`native.dialog.protected${kind}`, { origin }),
          detail: host.text(`native.dialog.protected${kind}Detail`),
          buttons: [host.text('native.dialog.cancel'), host.text(`native.dialog.chooseAnother${kind}`)],
          // As in every permission prompt, a held Enter from the picker refuses rather than reopening it.
          defaultId: 0,
          cancelId: 0,
          primaryId: 1
        })
        if (response === 1 && !closing.signal.aborted && isCurrent()) action = 'tryAgain'
      } finally {
        clearInterval(staleCheck)
        webContents.removeListener('did-frame-navigate', closeWhenStale)
        webContents.removeListener('did-fail-load', closeWhenStale)
        webContents.removeListener('destroyed', closeWhenStale)
        callback(action)
      }
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

  /**
   * Forgets the decisions made in a workspace the person closed or deleted for good, not one they archived, and tells
   * the shell windows.
   */
  async function forgetWorkspaceSitePermissions(workspaceId: string): Promise<void> {
    const store = host.state.sitePermissionStore
    if (!store) return
    try {
      if (await store.removeWorkspace(workspaceId)) publishSitePermissions()
    } catch (error) {
      console.error('[permissions] Failed to forget a removed workspace’s site permissions:', error)
    }
  }

  /**
   * Forgets the decisions of every workspace that is neither open nor archived, which a failed forget or a crash can
   * leave behind, and tells the shell windows. Startup calls it only once the workspaces loaded; `currentWorkspaces`
   * gives null once they are gone, such as at shutdown, which forgets nothing.
   */
  async function forgetRemovedWorkspacesSitePermissions(currentWorkspaces: () => Iterable<string> | null): Promise<void> {
    const store = host.state.sitePermissionStore
    if (!store) return
    try {
      if (await store.retainWorkspaces(currentWorkspaces)) publishSitePermissions()
    } catch (error) {
      console.error('[permissions] Failed to forget the site permissions of removed workspaces:', error)
    }
  }

  async function flushBrowserProfile(): Promise<void> {
    if (!host.state.persistentSession) return
    await flushBrowserSessionStorage(host.state.persistentSession)
  }

  return {
    configureBrowserSession,
    configurePersistentSession,
    publishSitePermissions,
    forgetWorkspaceSitePermissions,
    forgetRemovedWorkspacesSitePermissions,
    flushBrowserProfile
  }
}

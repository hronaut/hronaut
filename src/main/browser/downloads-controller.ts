import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { access, lstat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { shell, type DownloadItem, type Event, type Session, type WebContents } from 'electron'
import { isActiveDownload } from '../../shared/download-state.js'
import { redactNetworkUrl } from '../../shared/network-details.js'
import { isWindowsReservedFilename } from '../../shared/portable-filename.js'
import type { BrowserDownloadAction, BrowserDownloadState } from '../../shared/types.js'
import { LocalizedError } from '../localized-error.js'
import { DownloadDragIcons } from './download-drag-icons.js'
import { savedDownloads, type DownloadHistoryStore, type SavedDownload } from './download-history/download-history.js'
import { SavedLinkNames, savedLinkFilename, staysOnOrigin } from './saved-link-names.js'

const MAX_DOWNLOAD_HISTORY = 200
/** How soon after a change the download history is saved for the next start. */
const HISTORY_SAVE_MS = 1_000
const MAX_DOWNLOAD_URL_CHARS = 4_096

/**
 * The download address a record keeps, with credentials and secret query values redacted. A `data:` address holds the
 * file itself, often generated from the page's own data, so only its media type is kept, as `data:text/csv,`; any other
 * address is cut at 4,096 characters. Every list, MCP result and panel update carries this address.
 */
function retainedDownloadUrl(downloadUrl: string): string {
  // Checked after redaction, which parses the address, so leading spaces cannot hide a `data:` scheme.
  const redacted = redactNetworkUrl(downloadUrl)
  if (/^data:/i.test(redacted)) {
    const mediaType = /^data:([a-z\d!#$&^_.+-]{1,127}\/[a-z\d!#$&^_.+-]{1,127})[;,]/i.exec(redacted)?.[1]
    return `data:${mediaType?.toLowerCase() ?? ''},`
  }
  return redacted.slice(0, MAX_DOWNLOAD_URL_CHARS)
}

/** Retry downloads an address again only over HTTP(S): a `blob:` address ends with its page and a `data:` one is not kept. */
function isRetryableUrl(downloadUrl: string): boolean {
  return /^https?:/i.test(downloadUrl)
}

/** A retry started in a session that has not started downloading yet, which has no page to name its workspace. */
interface PendingRetry {
  url: string
  workspaceId: string
  /** The workspace's observation when the retry was asked for, which the transfer keeps, as a page's download does. */
  observationGeneration: number
  expiresAt: number
}

/** How long a retry waits for its download to start, as a server can take a while to answer. */
const PENDING_RETRY_MS = 5 * 60_000

/** A finished download's file, with its identity as Hronaut saw it when the download completed. */
export interface CompletedDownloadFile {
  savePath: string
  /**
   * Device, inode, and modification and change times in nanoseconds, as decimal strings so no precision is lost.
   * Any write or metadata change moves the change time, which programs cannot set back.
   */
  identity: { dev: string; ino: string; size: number; mtimeNs: string; ctimeNs: string }
}

interface BrowserDownloadsHost {
  getSettings(): { downloadDirectory: string; askWhereToSaveDownloads?: boolean; saveDialogTitle: string }
  getSource(webContentsId: number | undefined, downloadUrl: string): {
    tabId?: string
    workspaceId?: string
    observationGeneration: number
  }
  workspaceObservationGeneration(workspaceId: string): number
  /** Whether the workspace is open and not being deleted, so a download of it can be downloaded again there. */
  isWorkspaceOpen(workspaceId: string): boolean
  /**
   * The open workspace's session, hooked as its pages' sessions are, which a retried download starts in, or undefined
   * while the workspace is being deleted. Throws while another operation holds the workspace busy.
   */
  retrySession(workspaceId: string): Session | undefined
  /** Whether the workspace's Site access allows the address, recording a denial as a blocked navigation does. */
  allowsAddress(workspaceId: string, url: string, source: 'direct' | 'redirect'): boolean
  /**
   * Called once for each download, with the page it started from, when the download has its file: at once, or after
   * the save dialog when Hronaut asks where to save, or when it ends before that, such as when the person cancels the
   * dialog, the download folder cannot be written or a full download history refuses it.
   */
  downloadReady(webContentsId: number | undefined): void
  isAvailable(): boolean
  publish(downloads: BrowserDownloadState[]): void
}

/** Endings after which Chrome counts a short part before them as part of the extension, as in `.tar.gz` or `.tar.zst`. */
const COMPRESSED_ENDING = /^\.(?:bz2?|gz|lz(?:ma|o)?|xz|z|zst)$/i

/**
 * A download name's extension as Chrome reads it: one to four characters before a compressed ending count as part of
 * it, as does `.user` before `.js`, so a second `release.tar.gz` is saved as `release (1).tar.gz` rather than
 * `release.tar (1).gz`, and a shortened name keeps both parts.
 */
function downloadExtension(filename: string): string {
  const final = extname(filename)
  if (!final) return final
  const inner = extname(filename.slice(0, -final.length))
  if (inner.length < 2) return final
  if ((inner + final).toLowerCase() === '.user.js') return inner + final
  return COMPRESSED_ENDING.test(final) && inner.length <= 5 ? inner + final : final
}

/** Whether a finished download's file is still there. Only a missing file counts as gone; one Hronaut may not read stays. */
async function fileStillThere(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    return code !== 'ENOENT' && code !== 'ENOTDIR'
  }
}

/** Owns native downloads; the manager remains authoritative for tabs and workspaces. */
export class BrowserDownloadsController {
  private readonly downloadHookSessions = new Map<Session, () => void>()
  private readonly downloadItemListeners = new Map<DownloadItem, () => void>()
  private destroyed = false
  private readonly downloads = new Map<string, BrowserDownloadState>()
  private readonly downloadItems = new Map<string, DownloadItem>()
  /** Downloads still waiting for the person to choose where to save them, which Chrome lists only once they have. */
  private readonly awaitingSavePath = new Set<string>()
  /** The session each download in progress runs in, which a closed workspace's storage keeps for it until it ends. */
  private readonly downloadSessions = new Map<string, Session>()
  private readonly downloadWorkspaceIds = new Map<string, string | undefined>()
  /** Save paths handed to downloads that Chromium may not have created yet, keyed by `reservationKey`. */
  private readonly reservedDownloadPaths = new Set<string>()
  /** Read once when each download completes, so a later copy can refuse a file that was replaced or changed. */
  private readonly completedFileIdentities = new Map<string, Promise<CompletedDownloadFile['identity'] | undefined>>()
  private downloadNotifyTimer: NodeJS.Timeout | null = null
  /** How many times each record's file has been checked, so only the newest check's answer counts. */
  private readonly fileChecks = new Map<string, number>()
  private fileCheckRunning = false
  private fileCheckRequested = false
  private readonly savedLinkNames = new SavedLinkNames()
  private readonly dragIcons = new DownloadDragIcons()
  /** Where the download history is kept for the next start, once the history it kept is back, so no save loses it. */
  private history: DownloadHistoryStore | undefined
  private historySaveTimer: NodeJS.Timeout | null = null
  /**
   * Workspaces deleted with their data: their downloads stay in the list until Hronaut quits but are not kept for the
   * next start, as Recently closed drops their tabs.
   */
  private readonly deletedWorkspaceIds = new Set<string>()
  /**
   * The address each download can be downloaded again from, in full, as Chrome's Retry uses it, for HTTP(S) addresses
   * only. Kept in memory and never listed, as a record's address is redacted; one kept from before the restart is its
   * saved address, which the history marks as retryable only when nothing in it was redacted or cut.
   */
  private readonly retryUrls = new Map<string, string>()
  private readonly pendingRetries = new Map<Session, PendingRetry[]>()

  constructor(private readonly host: BrowserDownloadsHost, private readonly platform = process.platform) {}

  /**
   * Brings back the downloads kept from before the restart, as Chrome's Downloads page lists them, each with its
   * workspace, and keeps the history in that store from now on. Their files are checked when the Downloads panel
   * opens, as for a download of this run, and their addresses are redacted again, as a record keeps them. One saved as
   * retryable can be downloaded again from its address while redacting it again changes nothing.
   */
  restoreHistory(saved: readonly SavedDownload[], history: DownloadHistoryStore): void {
    for (const { workspaceId, retryable, ...download } of saved.slice(0, MAX_DOWNLOAD_HISTORY)) {
      if (this.downloads.has(download.id)) continue
      const url = retainedDownloadUrl(download.url)
      if (retryable && url === download.url && isRetryableUrl(url)) this.retryUrls.set(download.id, url)
      this.downloads.set(download.id, {
        ...download,
        url,
        paused: false,
        canResume: false,
        fromEarlierRun: true,
        ...(workspaceId ? { observationGeneration: this.host.workspaceObservationGeneration(workspaceId) } : {})
      })
      this.downloadWorkspaceIds.set(download.id, workspaceId)
    }
    this.history = history
  }

  /**
   * Saves the download history for the next start now, as when Hronaut quits, without the downloads of workspaces
   * deleted with their data. A failure is logged; a save after a change does not write again what just failed.
   */
  async saveHistory(retryFailedWrite = true): Promise<void> {
    if (this.historySaveTimer) clearTimeout(this.historySaveTimer)
    this.historySaveTimer = null
    if (!this.history) return
    await this.history.save(() => {
      if (this.destroyed) return undefined
      const kept = this.listDownloads().filter((download) => {
        const workspaceId = this.downloadWorkspaceIds.get(download.id)
        return !workspaceId || !this.deletedWorkspaceIds.has(workspaceId)
      })
      return savedDownloads(
        kept,
        (downloadId) => this.downloadWorkspaceIds.get(downloadId),
        // Only when the address it keeps is the one it downloads again from, so a restart can still retry it.
        (download) => this.retryUrls.get(download.id) === download.url
      )
    }, retryFailedWrite).catch((error: unknown) => console.error('[downloads] Failed to save the download history:', error))
  }

  private scheduleHistorySave(): void {
    if (!this.history || this.destroyed || this.historySaveTimer) return
    this.historySaveTimer = setTimeout(() => {
      this.historySaveTimer = null
      void this.saveHistory(false)
    }, HISTORY_SAVE_MS)
  }

  /**
   * Leaves the downloads of a workspace deleted with its data out of the history kept for the next start, and drops its
   * retries that have not started downloading, so none starts in its deleted storage.
   */
  forgetWorkspace(workspaceId: string): void {
    if (this.destroyed) return
    this.deletedWorkspaceIds.add(workspaceId)
    for (const [browserSession, pending] of this.pendingRetries) {
      const kept = pending.filter((retry) => retry.workspaceId !== workspaceId)
      if (kept.length) this.pendingRetries.set(browserSession, kept)
      else this.pendingRetries.delete(browserSession)
    }
    // Its downloads no longer offer Retry.
    this.notifyDownloadsChanged()
    this.scheduleHistorySave()
  }

  hasActiveDownload(tabId: string): boolean {
    return [...this.downloads.values()].some(download => download.tabId === tabId && isActiveDownload(download))
  }

  /**
   * Settles once every download of this session that has not ended does, or is undefined when there is none. A paused
   * download, or one Chromium stopped and can resume, has not ended either: as in Chrome, it can still be resumed.
   */
  downloadsEnd(browserSession: Session): Promise<void> | undefined {
    const unfinished = [...this.downloadItems].filter(([id]) => this.downloadSessions.get(id) === browserSession)
    if (!unfinished.length) return undefined
    return Promise.all(unfinished.map(([, item]) => new Promise<void>((resolve) => { item.once('done', () => resolve()) })))
      .then(() => undefined)
  }

  advanceWorkspaceObservationGeneration(workspaceId: string, observationGeneration: number): void {
    for (const [downloadId, ownerWorkspaceId] of this.downloadWorkspaceIds) {
      if (ownerWorkspaceId !== workspaceId) continue
      const download = this.downloads.get(downloadId)
      if (download && !isActiveDownload(download)) download.observationGeneration = observationGeneration
    }
  }

  clearPendingNotification(): void {
    if (this.downloadNotifyTimer) clearTimeout(this.downloadNotifyTimer)
    this.downloadNotifyTimer = null
  }

  destroy(): void {
    this.destroyed = true
    this.clearPendingNotification()
    if (this.historySaveTimer) clearTimeout(this.historySaveTimer)
    this.historySaveTimer = null
    for (const detach of this.downloadHookSessions.values()) detach()
    this.downloadHookSessions.clear()
    for (const detach of this.downloadItemListeners.values()) detach()
    this.downloadItemListeners.clear()
    this.downloadItems.clear()
    this.awaitingSavePath.clear()
    this.downloadSessions.clear()
    this.downloadWorkspaceIds.clear()
    this.deletedWorkspaceIds.clear()
    this.retryUrls.clear()
    this.pendingRetries.clear()
    this.reservedDownloadPaths.clear()
    this.completedFileIdentities.clear()
    this.fileChecks.clear()
    this.savedLinkNames.clear()
  }

  /**
   * Names the download that Save Link As is about to start from this page with the link's `download` name, which
   * Electron's `downloadURL` cannot carry, unless the server names the file itself, as in Chrome.
   */
  expectSavedLinkName(webContentsId: number, url: string, linkName: string): void {
    if (!this.destroyed) this.savedLinkNames.expect(webContentsId, url, linkName)
  }

  listDownloads(): BrowserDownloadState[] {
    for (const [id, item] of this.downloadItems) {
      const download = this.downloads.get(id)
      if (!download) continue
      download.state = item.getState()
      download.receivedBytes = item.getReceivedBytes()
      download.totalBytes = item.getTotalBytes()
      this.syncDownloadPath(download, item)
      download.paused = item.isPaused()
      download.canResume = download.paused || (download.state === 'interrupted' && item.canResume())
      // canResume describes user action availability, not whether an interrupted
      // transfer is done. Its done listener owns terminal interruption cleanup.
      if (download.state === 'completed' || download.state === 'cancelled') {
        download.paused = false
        download.canResume = false
        download.completedAt ??= new Date().toISOString()
        this.downloadItems.delete(id)
        this.downloadSessions.delete(id)
      }
    }
    return [...this.downloads.values()]
      .filter((download) => !this.awaitingSavePath.has(download.id))
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .map((download) => (this.canRetry(download) ? { ...download, canRetry: true } : { ...download }))
  }

  /**
   * Whether a download can be downloaded again, as Chrome's Retry offers it: one that was cancelled or failed for good,
   * from an HTTP(S) address Hronaut still has in full, in a workspace that is open.
   */
  private canRetry(download: BrowserDownloadState): boolean {
    const workspaceId = this.downloadWorkspaceIds.get(download.id)
    return (download.state === 'cancelled' || download.state === 'interrupted') && !isActiveDownload(download)
      && this.retryUrls.has(download.id) && workspaceId !== undefined && this.host.isWorkspaceOpen(workspaceId)
  }

  /** The oldest retry waiting in this session for a download of this address, which then stops waiting. */
  private takeRetry(browserSession: Session, url: string): PendingRetry | undefined {
    const pending = this.pendingRetries.get(browserSession)
    if (!pending) return undefined
    const now = Date.now()
    const index = pending.findIndex((retry) => retry.expiresAt > now && retry.url === url)
    const retry = pending[index]
    const kept = pending.filter((candidate, position) => position !== index && candidate.expiresAt > now)
    if (kept.length) this.pendingRetries.set(browserSession, kept)
    else this.pendingRetries.delete(browserSession)
    return retry
  }

  /** Every download, as `listDownloads`, after starting a check of finished files for the Downloads panel opening. */
  listDownloadsCheckingFiles(): BrowserDownloadState[] {
    this.checkCompletedFiles()
    return this.listDownloads()
  }

  /**
   * Checks in the background that each completed download's file is still where it was saved, as Chrome does when its
   * downloads page opens: one file at a time, so a slow network folder holds no more than one of Node's file threads,
   * and once more after a check already running instead of beside it. A file that was moved or deleted marks its
   * record, so the Downloads panel says so instead of offering to show it in its folder; a file that is back clears
   * the mark. Each change is published as it settles.
   */
  private checkCompletedFiles(): void {
    this.fileCheckRequested = true
    if (this.fileCheckRunning || this.destroyed) return
    this.fileCheckRunning = true
    void this.runFileChecks().catch((error: unknown) => console.error('[downloads] Could not check finished files:', error))
  }

  private async runFileChecks(): Promise<void> {
    try {
      while (this.fileCheckRequested && !this.destroyed) {
        this.fileCheckRequested = false
        this.listDownloads()
        for (const download of [...this.downloads.values()]) {
          if (this.destroyed) return
          if (download.state === 'completed' && download.savePath) await this.checkFile(download, download.savePath)
        }
      }
    } finally {
      // In the same turn as the last loop test, so a request made after it starts a new run rather than being lost.
      this.fileCheckRunning = false
    }
  }

  /**
   * Whether a completed download's file is still there, recorded on the record unless it was removed or a newer check
   * of it started meanwhile, so a slow answer never replaces a newer one.
   */
  private async checkFile(download: BrowserDownloadState, savePath: string, publishNow = false): Promise<boolean> {
    const check = (this.fileChecks.get(download.id) ?? 0) + 1
    this.fileChecks.set(download.id, check)
    const present = await fileStillThere(savePath)
    if (this.downloads.get(download.id) === download && this.fileChecks.get(download.id) === check
      && this.markFileRemoved(download, !present)) this.notifyDownloadsChanged(publishNow)
    return present
  }

  /** Records whether a completed download's file is gone; returns whether that changed. */
  private markFileRemoved(download: BrowserDownloadState, removed: boolean): boolean {
    if ((download.fileRemoved === true) === removed) return false
    if (removed) download.fileRemoved = true
    else delete download.fileRemoved
    return true
  }

  removeFinishedDownload(downloadId: string): BrowserDownloadState[] {
    this.listDownloads()
    const download = this.downloads.get(downloadId)
    if (!download) throw new LocalizedError('appErrors.downloads.unavailable')
    if (isActiveDownload(download)) throw new LocalizedError('appErrors.downloads.removeActive')
    this.downloads.delete(downloadId)
    this.downloadWorkspaceIds.delete(downloadId)
    this.completedFileIdentities.delete(downloadId)
    this.fileChecks.delete(downloadId)
    this.retryUrls.delete(downloadId)
    const downloads = this.listDownloads()
    this.sendDownloadsChanged(downloads)
    return downloads
  }

  manageDownloads(action: BrowserDownloadAction, downloadId?: string): BrowserDownloadState[] {
    return this.manageScopedDownloads(action, downloadId)
  }

  manageWorkspaceDownloads(
    workspaceId: string,
    action: BrowserDownloadAction,
    downloadId?: string
  ): BrowserDownloadState[] {
    return this.manageScopedDownloads(action, downloadId, workspaceId)
  }

  private manageScopedDownloads(
    action: BrowserDownloadAction,
    downloadId?: string,
    workspaceId?: string
  ): BrowserDownloadState[] {
    const generation = workspaceId === undefined ? undefined : this.host.workspaceObservationGeneration(workspaceId)
    const inScope = (download: BrowserDownloadState) => workspaceId === undefined || (
      this.downloadWorkspaceIds.get(download.id) === workspaceId
      && download.observationGeneration === generation
    )
    this.listDownloads()
    if (action === 'cancel' || action === 'pause' || action === 'resume') {
      if (!downloadId) throw new Error(`downloadId is required to ${action} a download`)
      const download = this.downloads.get(downloadId)
      const item = download && inScope(download) ? this.downloadItems.get(downloadId) : undefined
      // MCP results keep these messages, which agents already read.
      if (!item) throw new LocalizedError('appErrors.downloads.notActive', undefined, { message: `Active download not found: ${downloadId}` })
      if (action === 'cancel') item.cancel()
      else if (action === 'pause') {
        if (item.getState() !== 'progressing') {
          throw new LocalizedError('appErrors.downloads.notProgressing', undefined, { message: 'Only a progressing download can be paused' })
        }
        item.pause()
      } else {
        if (!item.isPaused() && !(item.getState() === 'interrupted' && item.canResume())) {
          throw new LocalizedError('appErrors.downloads.notResumable', undefined, { message: 'Download is not paused or resumable' })
        }
        item.resume()
      }
    } else if (action === 'retry') {
      if (!downloadId) throw new Error('downloadId is required to retry a download')
      const download = this.downloads.get(downloadId)
      const workspaceId = this.downloadWorkspaceIds.get(downloadId)
      const url = this.retryUrls.get(downloadId)
      if (!download || !inScope(download) || !this.canRetry(download) || !workspaceId || !url) {
        throw new LocalizedError('appErrors.downloads.notRetryable', undefined, { message: `Download cannot be retried: ${downloadId}` })
      }
      const browserSession = this.host.retrySession(workspaceId)
      // The workspace's Site access may have changed since, as a page's download goes by it too.
      if (!browserSession || !this.host.allowsAddress(workspaceId, url, 'direct')) {
        throw new LocalizedError('appErrors.downloads.notRetryable', undefined, { message: `Download cannot be retried: ${downloadId}` })
      }
      const now = Date.now()
      const pending = (this.pendingRetries.get(browserSession) ?? []).filter((retry) => retry.expiresAt > now)
      pending.push({ url, workspaceId, observationGeneration: this.host.workspaceObservationGeneration(workspaceId), expiresAt: now + PENDING_RETRY_MS })
      this.pendingRetries.set(browserSession, pending)
      // As Chrome's Retry: a new download of the address in the workspace's session, with its cookies, beside the old row.
      browserSession.downloadURL(url)
    } else if (action === 'clear') {
      for (const [id, download] of this.downloads) {
        if (!inScope(download) || isActiveDownload(download)) continue
        this.downloads.delete(id)
        this.downloadWorkspaceIds.delete(id)
        this.completedFileIdentities.delete(id)
        this.fileChecks.delete(id)
        this.retryUrls.delete(id)
      }
    }
    const downloads = this.listDownloads()
    if (action !== 'list') this.sendDownloadsChanged(downloads)
    return downloads.filter(inScope)
  }

  remapDownloadWorkspaceOwnership(sourceWorkspaceId: string, targetWorkspaceId: string): void {
    for (const [downloadId, workspaceId] of this.downloadWorkspaceIds) {
      if (workspaceId !== sourceWorkspaceId) continue
      this.downloadWorkspaceIds.set(downloadId, targetWorkspaceId)
      const download = this.downloads.get(downloadId)
      // As when the observation advances, a live transfer stays with the observation that started it.
      if (download && !isActiveDownload(download)) download.observationGeneration = this.host.workspaceObservationGeneration(targetWorkspaceId)
    }
    // Archiving or restoring the workspace changes which of its downloads Retry is offered for.
    this.notifyDownloadsChanged()
  }

  /**
   * The file of a download this workspace finished, as recorded when it
   * completed. Throws for a record outside the workspace's current
   * observation, one that did not complete, and one whose file Hronaut did
   * not record; messages never name the path.
   */
  async completedWorkspaceDownloadFile(workspaceId: string, downloadId: string): Promise<CompletedDownloadFile> {
    this.listDownloads()
    const download = this.downloads.get(downloadId)
    const notFound = `Download not found in this workspace: ${downloadId}`
    const inScope = (): boolean => this.downloads.get(downloadId) === download
      && this.downloadWorkspaceIds.get(downloadId) === workspaceId
      && download?.observationGeneration === this.host.workspaceObservationGeneration(workspaceId)
    if (!download || !inScope()) throw new Error(notFound)
    if (download.state !== 'completed' || !download.savePath) throw new Error('Only a completed download can be copied.')
    // Read only as a download completes in this run, so one kept from before the restart has none.
    if (!this.completedFileIdentities.has(downloadId)) {
      throw new Error('This download finished before Hronaut restarted, so Hronaut cannot check that its file is unchanged and will not copy it. Download the file again to copy it.')
    }
    const identity = await this.completedFileIdentities.get(downloadId)
    // The record may have been cleared or handed to another workspace while its identity was read.
    if (!inScope()) throw new Error(notFound)
    if (!identity) {
      throw new Error('Hronaut has no record of this download\'s file as it finished (it may still be finishing, or the file was already gone), so it cannot be copied. List downloads and try again.')
    }
    return { savePath: download.savePath, identity }
  }

  async showDownloadInFolder(downloadId: string): Promise<void> {
    const download = this.downloads.get(downloadId)
    if (!download) throw new LocalizedError('appErrors.downloads.unavailable')
    const savePath = download.state === 'completed' ? download.savePath : undefined
    if (!savePath) throw new LocalizedError('appErrors.downloads.notCompleted')
    // The row changes with the error, not after the next progress update.
    const present = await this.checkFile(download, savePath, true)
    if (this.downloads.get(downloadId) !== download) throw new LocalizedError('appErrors.downloads.unavailable')
    if (!present) throw new LocalizedError('appErrors.downloads.fileRemoved')
    shell.showItemInFolder(savePath)
  }

  /**
   * Drags a completed download's file out of the Downloads panel, as from Chrome's downloads, to a folder, another app
   * or a page, with the file's own icon. The drag starts from the window the panel is in, and only once its file is
   * checked to be there; the page or app it is dropped on gets the file as from the person's own folder. The person
   * holds the pointer until it starts, so the check and the icon, usually read when the file finished, wait together.
   */
  async startDownloadDrag(downloadId: string, sender: WebContents): Promise<void> {
    const download = this.downloads.get(downloadId)
    if (!download) throw new LocalizedError('appErrors.downloads.unavailable')
    const savePath = download.state === 'completed' ? download.savePath : undefined
    if (!savePath) throw new LocalizedError('appErrors.downloads.dragNotCompleted')
    const [present, icon] = await Promise.all([this.checkFile(download, savePath, true), this.dragIcons.icon(savePath)])
    if (this.downloads.get(downloadId) !== download) throw new LocalizedError('appErrors.downloads.unavailable')
    if (!present) throw new LocalizedError('appErrors.downloads.dragFileRemoved')
    // The panel's window closed meanwhile, so nothing is left to drag from.
    if (sender.isDestroyed()) return
    sender.startDrag({ file: savePath, icon })
  }

  attachSession(browserSession: Session): void {
    if (!this.destroyed && !this.downloadHookSessions.has(browserSession)) {
      const onWillDownload = (event: Event, item: DownloadItem, webContents: WebContents) => {
        // Taken first, so a download refused below cannot leave its name for the next one.
        const urlChain = item.getURLChain()
        const linkName = this.savedLinkNames.take(webContents?.id, urlChain[0] ?? item.getURL())
        // A retry starts from no page, so the retry names its workspace.
        const retry = webContents ? undefined : this.takeRetry(browserSession, urlChain[0] ?? item.getURL())
        // Electron gives a download without a page no redirect check, so one that went outside the workspace's Site
        // access is refused here, as a page's redirect there is.
        if (retry && urlChain.slice(1).some((url) => !this.host.allowsAddress(retry.workspaceId, url, 'redirect'))) {
          event.preventDefault()
          return
        }
        this.trimDownloadHistory()
        if (this.downloads.size >= MAX_DOWNLOAD_HISTORY) {
          event.preventDefault()
          // Refused, as a download the person cancels, which leaves its tab as empty.
          this.host.downloadReady(webContents?.id)
          return
        }
        const id = randomUUID()
        const downloadUrl = item.getURL()
        const sourceWebContentsId = webContents?.id
        let readyReported = false
        const reportReady = () => {
          if (readyReported) return
          readyReported = true
          this.host.downloadReady(sourceWebContentsId)
        }
        const { tabId, workspaceId, observationGeneration } = retry
          ? { tabId: undefined, workspaceId: retry.workspaceId, observationGeneration: retry.observationGeneration }
          : this.host.getSource(sourceWebContentsId, downloadUrl)
        const settings = this.host.getSettings()
        // As for a click on the link, the name holds only while the download stays on the link's origin: Hronaut saves
        // without asking, so a redirect elsewhere must not get to name its file, such as a script saved as `update.bat`.
        const filename = linkName && staysOnOrigin(urlChain)
          ? savedLinkFilename(linkName, item.getFilename(), item.getContentDisposition())
          : item.getFilename()
        const download: BrowserDownloadState = {
          id,
          observationGeneration,
          tabId,
          url: retainedDownloadUrl(downloadUrl),
          filename: basename(filename) || 'download',
          savePath: '',
          state: 'progressing',
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes(),
          startedAt: new Date().toISOString()
        }
        this.downloads.set(id, download)
        this.downloadWorkspaceIds.set(id, workspaceId)
        if (isRetryableUrl(downloadUrl)) this.retryUrls.set(id, downloadUrl)
        let suggestedPath = ''
        try {
          suggestedPath = this.reserveAvailableDownloadPath(filename, settings.downloadDirectory)
          if (settings.askWhereToSaveDownloads) {
            item.setSaveDialogOptions({
              title: settings.saveDialogTitle,
              defaultPath: suggestedPath
            })
          } else {
            item.setSavePath(suggestedPath)
          }
        } catch {
          this.reservedDownloadPaths.delete(this.reservationKey(suggestedPath))
          event.preventDefault()
          download.state = 'interrupted'
          download.failureReason = 'destination-unavailable'
          download.completedAt = new Date().toISOString()
          download.paused = false
          download.canResume = false
          this.notifyDownloadsChanged(true)
          reportReady()
          return
        }
        download.filename = basename(suggestedPath)
        download.savePath = settings.askWhereToSaveDownloads ? '' : suggestedPath
        this.downloadItems.set(id, item)
        if (settings.askWhereToSaveDownloads) this.awaitingSavePath.add(id)
        this.downloadSessions.set(id, browserSession)
        const onUpdated = (_downloadEvent: Event, state: 'interrupted' | 'progressing') => {
          download.state = state === 'interrupted' ? 'interrupted' : 'progressing'
          download.receivedBytes = item.getReceivedBytes()
          download.totalBytes = item.getTotalBytes()
          this.syncDownloadPath(download, item)
          // Listed once the person chose where to save it, which opens the Downloads panel then, as in Chrome.
          const chosen = Boolean(item.getSavePath()) && this.awaitingSavePath.delete(id)
          this.notifyDownloadsChanged(chosen)
          if (item.getSavePath()) reportReady()
        }
        const onDone = (_downloadEvent: Event, state: 'completed' | 'cancelled' | 'interrupted') => {
          detachItemListeners()
          this.reservedDownloadPaths.delete(this.reservationKey(suggestedPath))
          if (this.awaitingSavePath.delete(id) && state === 'cancelled' && !item.getSavePath()) {
            // Cancelled in the save dialog, so as in Chrome it leaves no Cancelled row behind.
            this.downloads.delete(id)
            this.downloadWorkspaceIds.delete(id)
            this.retryUrls.delete(id)
            this.downloadItems.delete(id)
            this.downloadSessions.delete(id)
            reportReady()
            return
          }
          download.state = state
          download.receivedBytes = item.getReceivedBytes()
          download.totalBytes = item.getTotalBytes()
          this.syncDownloadPath(download, item)
          download.paused = false
          download.canResume = false
          download.completedAt = new Date().toISOString()
          if (state === 'completed' && download.savePath) this.recordCompletedFile(id, download.savePath)
          // Read now, so a drag out of Downloads starts at once.
          if (state === 'completed' && download.savePath) void this.dragIcons.icon(download.savePath)
          // Only a download that did not complete is downloaded again, so a completed one's address is not kept.
          if (state === 'completed') this.retryUrls.delete(id)
          this.downloadItems.delete(id)
          this.downloadSessions.delete(id)
          this.trimDownloadHistory()
          this.notifyDownloadsChanged(true)
          reportReady()
        }
        const detachItemListeners = () => {
          item.removeListener('updated', onUpdated)
          item.removeListener('done', onDone)
          this.downloadItemListeners.delete(item)
        }
        this.downloadItemListeners.set(item, detachItemListeners)
        item.on('updated', onUpdated)
        item.once('done', onDone)
        this.notifyDownloadsChanged(true)
        // A new download opens the Downloads panel, so its finished files are checked as when the panel opens.
        this.checkCompletedFiles()
        if (!settings.askWhereToSaveDownloads) reportReady()
      }
      browserSession.on('will-download', onWillDownload)
      this.downloadHookSessions.set(browserSession, () => browserSession.removeListener('will-download', onWillDownload))
    }
  }

  private reserveAvailableDownloadPath(filename: string, directory: string): string {
    const sourceFilename = basename(filename) || 'download'
    const safeFilename = isWindowsReservedFilename(sourceFilename)
      ? `download-${sourceFilename}`
      : sourceFilename
    const sourceExtension = downloadExtension(safeFilename)
    // An extension too long to keep with any of the name is cut along with it.
    const extension = Buffer.byteLength(sourceExtension) <= 200 ? sourceExtension : ''
    const stem = safeFilename.slice(0, safeFilename.length - extension.length)
    // Chromium's suggested name may be longer than file systems allow (255 bytes), which Chrome shortens only when it
    // picks the path itself, and a collision suffix needs room too. Shorten the name before its extension in one pass,
    // as a page can suggest a very long name, without splitting a Unicode character. A shortened name loses trailing
    // spaces and dots, which Windows would drop itself, and is named `download` when nothing else is left or prefixed
    // with it when it became a Windows device name.
    const fitted = (suffix: string): string => {
      if (Buffer.byteLength(stem) + Buffer.byteLength(suffix) <= 255) return stem + suffix
      let room = 255 - Buffer.byteLength(suffix)
      let kept = ''
      for (const character of stem) {
        room -= Buffer.byteLength(character)
        if (room < 0) break
        kept += character
      }
      const name = (kept.replace(/[ .]+$/, '') || 'download') + suffix
      return isWindowsReservedFilename(name) ? `download-${name}` : name
    }
    const direct = join(directory, fitted(extension))
    const directKey = this.reservationKey(direct)
    if (!existsSync(direct) && !this.reservedDownloadPaths.has(directKey)) {
      this.reservedDownloadPaths.add(directKey)
      return direct
    }
    for (let index = 1; index <= 9_999; index += 1) {
      const candidate = join(directory, fitted(` (${index})${extension}`))
      const candidateKey = this.reservationKey(candidate)
      if (existsSync(candidate) || this.reservedDownloadPaths.has(candidateKey)) continue
      this.reservedDownloadPaths.add(candidateKey)
      return candidate
    }
    throw new Error(`Could not allocate a unique download path for ${safeFilename}`)
  }

  /**
   * The default file systems of macOS and Windows treat names that differ only in letter case as the same file, and
   * macOS also names that differ only in Unicode normalization, so two downloads reserved as `Report.pdf` and
   * `report.pdf` would end up in one file there. Linux's usual file systems keep them apart.
   */
  private reservationKey(path: string): string {
    if (this.platform === 'darwin') return path.normalize('NFC').toLowerCase()
    return this.platform === 'win32' ? path.toLowerCase() : path
  }

  /** Records the completed file's identity, without following a symbolic link; anything but a regular file records none. */
  private recordCompletedFile(downloadId: string, savePath: string): void {
    this.completedFileIdentities.set(downloadId, lstat(savePath, { bigint: true }).then(
      info => info.isFile()
        ? { dev: String(info.dev), ino: String(info.ino), size: Number(info.size), mtimeNs: String(info.mtimeNs), ctimeNs: String(info.ctimeNs) }
        : undefined,
      () => undefined
    ))
  }

  private syncDownloadPath(download: BrowserDownloadState, item: DownloadItem): void {
    const savePath = item.getSavePath()
    if (!savePath) return
    download.savePath = savePath
    download.filename = basename(savePath)
  }

  private trimDownloadHistory(): void {
    if (this.downloads.size < MAX_DOWNLOAD_HISTORY) return
    const removable = [...this.downloads.values()]
      .filter((download) => !isActiveDownload(download))
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    while (this.downloads.size >= MAX_DOWNLOAD_HISTORY && removable.length) {
      const id = removable.shift()!.id
      this.downloads.delete(id)
      this.downloadWorkspaceIds.delete(id)
      this.completedFileIdentities.delete(id)
      this.fileChecks.delete(id)
      this.retryUrls.delete(id)
    }
  }

  private notifyDownloadsChanged(immediate = false): void {
    if (this.destroyed || !this.host.isAvailable()) return
    if (immediate) {
      if (this.downloadNotifyTimer) clearTimeout(this.downloadNotifyTimer)
      this.downloadNotifyTimer = null
      this.sendDownloadsChanged(this.listDownloads())
      return
    }
    if (this.downloadNotifyTimer) return
    this.downloadNotifyTimer = setTimeout(() => {
      this.downloadNotifyTimer = null
      this.sendDownloadsChanged(this.listDownloads())
    }, 120)
  }

  private sendDownloadsChanged(downloads: BrowserDownloadState[]): void {
    this.host.publish(downloads)
    this.scheduleHistorySave()
  }
}

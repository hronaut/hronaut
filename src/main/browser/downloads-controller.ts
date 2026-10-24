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
import { SavedLinkNames, savedLinkFilename, staysOnOrigin } from './saved-link-names.js'

const MAX_DOWNLOAD_HISTORY = 200
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
  /**
   * Called once for each download Hronaut keeps, with the page it started from, when the download has its file: at
   * once, or after the save dialog when Hronaut asks where to save, or when it ends before that, such as when the
   * person cancels the dialog or the download folder cannot be written.
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

  constructor(private readonly host: BrowserDownloadsHost, private readonly platform = process.platform) {}

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
    for (const detach of this.downloadHookSessions.values()) detach()
    this.downloadHookSessions.clear()
    for (const detach of this.downloadItemListeners.values()) detach()
    this.downloadItemListeners.clear()
    this.downloadItems.clear()
    this.downloadSessions.clear()
    this.downloadWorkspaceIds.clear()
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
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .map((download) => ({ ...download }))
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
    } else if (action === 'clear') {
      for (const [id, download] of this.downloads) {
        if (!inScope(download) || isActiveDownload(download)) continue
        this.downloads.delete(id)
        this.downloadWorkspaceIds.delete(id)
        this.completedFileIdentities.delete(id)
        this.fileChecks.delete(id)
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

  attachSession(browserSession: Session): void {
    if (!this.destroyed && !this.downloadHookSessions.has(browserSession)) {
      const onWillDownload = (event: Event, item: DownloadItem, webContents: WebContents) => {
        // Taken first, so a download refused below cannot leave its name for the next one.
        const urlChain = item.getURLChain()
        const linkName = this.savedLinkNames.take(webContents?.id, urlChain[0] ?? item.getURL())
        this.trimDownloadHistory()
        if (this.downloads.size >= MAX_DOWNLOAD_HISTORY) {
          event.preventDefault()
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
        const { tabId, workspaceId, observationGeneration } = this.host.getSource(sourceWebContentsId, downloadUrl)
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
        this.downloadSessions.set(id, browserSession)
        const onUpdated = (_downloadEvent: Event, state: 'interrupted' | 'progressing') => {
          download.state = state === 'interrupted' ? 'interrupted' : 'progressing'
          download.receivedBytes = item.getReceivedBytes()
          download.totalBytes = item.getTotalBytes()
          this.syncDownloadPath(download, item)
          this.notifyDownloadsChanged()
          if (item.getSavePath()) reportReady()
        }
        const onDone = (_downloadEvent: Event, state: 'completed' | 'cancelled' | 'interrupted') => {
          detachItemListeners()
          this.reservedDownloadPaths.delete(this.reservationKey(suggestedPath))
          download.state = state
          download.receivedBytes = item.getReceivedBytes()
          download.totalBytes = item.getTotalBytes()
          this.syncDownloadPath(download, item)
          download.paused = false
          download.canResume = false
          download.completedAt = new Date().toISOString()
          if (state === 'completed' && download.savePath) this.recordCompletedFile(id, download.savePath)
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
  }
}

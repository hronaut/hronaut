import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { shell, type DownloadItem, type Event, type Session, type WebContents } from 'electron'
import { isActiveDownload } from '../../shared/download-state.js'
import { redactNetworkUrl } from '../../shared/network-details.js'
import { isWindowsReservedFilename } from '../../shared/portable-filename.js'
import type { BrowserDownloadAction, BrowserDownloadState } from '../../shared/types.js'

const MAX_DOWNLOAD_HISTORY = 200

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
  isAvailable(): boolean
  publish(downloads: BrowserDownloadState[]): void
}

/** Owns native downloads; the manager remains authoritative for tabs and workspaces. */
export class BrowserDownloadsController {
  private readonly downloadHookSessions = new Map<Session, () => void>()
  private readonly downloadItemListeners = new Map<DownloadItem, () => void>()
  private destroyed = false
  private readonly downloads = new Map<string, BrowserDownloadState>()
  private readonly downloadItems = new Map<string, DownloadItem>()
  private readonly downloadWorkspaceIds = new Map<string, string | undefined>()
  private readonly reservedDownloadPaths = new Set<string>()
  /** Read once when each download completes, so a later copy can refuse a file that was replaced or changed. */
  private readonly completedFileIdentities = new Map<string, Promise<CompletedDownloadFile['identity'] | undefined>>()
  private downloadNotifyTimer: NodeJS.Timeout | null = null

  constructor(private readonly host: BrowserDownloadsHost) {}

  hasActiveDownload(tabId: string): boolean {
    return [...this.downloads.values()].some(download => download.tabId === tabId && isActiveDownload(download))
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
    this.downloadWorkspaceIds.clear()
    this.reservedDownloadPaths.clear()
    this.completedFileIdentities.clear()
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
      }
    }
    return [...this.downloads.values()]
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .map((download) => ({ ...download }))
  }

  removeFinishedDownload(downloadId: string): BrowserDownloadState[] {
    this.listDownloads()
    const download = this.downloads.get(downloadId)
    if (!download) throw new Error('Download record not found')
    if (isActiveDownload(download)) throw new Error('Only finished download records can be removed')
    this.downloads.delete(downloadId)
    this.downloadWorkspaceIds.delete(downloadId)
    this.completedFileIdentities.delete(downloadId)
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
      if (!item) throw new Error(`Active download not found: ${downloadId}`)
      if (action === 'cancel') item.cancel()
      else if (action === 'pause') {
        if (item.getState() !== 'progressing') throw new Error('Only a progressing download can be paused')
        item.pause()
      } else {
        if (!item.isPaused() && !(item.getState() === 'interrupted' && item.canResume())) {
          throw new Error('Download is not paused or resumable')
        }
        item.resume()
      }
    } else if (action === 'clear') {
      for (const [id, download] of this.downloads) {
        if (!inScope(download) || isActiveDownload(download)) continue
        this.downloads.delete(id)
        this.downloadWorkspaceIds.delete(id)
        this.completedFileIdentities.delete(id)
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
      if (download) download.observationGeneration = this.host.workspaceObservationGeneration(targetWorkspaceId)
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

  showDownloadInFolder(downloadId: string): void {
    const download = this.downloads.get(downloadId)
    if (!download) throw new Error(`Download not found: ${downloadId}`)
    if (download.state !== 'completed' || !download.savePath || !existsSync(download.savePath)) {
      throw new Error('Only a completed download that still exists can be shown in its folder')
    }
    shell.showItemInFolder(download.savePath)
  }

  attachSession(browserSession: Session): void {
    if (!this.destroyed && !this.downloadHookSessions.has(browserSession)) {
      const onWillDownload = (event: Event, item: DownloadItem, webContents: WebContents) => {
        this.trimDownloadHistory()
        if (this.downloads.size >= MAX_DOWNLOAD_HISTORY) {
          event.preventDefault()
          return
        }
        const id = randomUUID()
        const downloadUrl = item.getURL()
        const { tabId, workspaceId, observationGeneration } = this.host.getSource(webContents?.id, downloadUrl)
        const settings = this.host.getSettings()
        const filename = item.getFilename()
        const download: BrowserDownloadState = {
          id,
          observationGeneration,
          tabId,
          url: redactNetworkUrl(downloadUrl),
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
          this.reservedDownloadPaths.delete(suggestedPath)
          event.preventDefault()
          download.state = 'interrupted'
          download.failureReason = 'destination-unavailable'
          download.completedAt = new Date().toISOString()
          download.paused = false
          download.canResume = false
          this.notifyDownloadsChanged(true)
          return
        }
        download.filename = basename(suggestedPath)
        download.savePath = settings.askWhereToSaveDownloads ? '' : suggestedPath
        this.downloadItems.set(id, item)
        const onUpdated = (_downloadEvent: Event, state: 'interrupted' | 'progressing') => {
          download.state = state === 'interrupted' ? 'interrupted' : 'progressing'
          download.receivedBytes = item.getReceivedBytes()
          download.totalBytes = item.getTotalBytes()
          this.syncDownloadPath(download, item)
          this.notifyDownloadsChanged()
        }
        const onDone = (_downloadEvent: Event, state: 'completed' | 'cancelled' | 'interrupted') => {
          detachItemListeners()
          this.reservedDownloadPaths.delete(suggestedPath)
          download.state = state
          download.receivedBytes = item.getReceivedBytes()
          download.totalBytes = item.getTotalBytes()
          this.syncDownloadPath(download, item)
          download.paused = false
          download.canResume = false
          download.completedAt = new Date().toISOString()
          if (state === 'completed' && download.savePath) this.recordCompletedFile(id, download.savePath)
          this.downloadItems.delete(id)
          this.trimDownloadHistory()
          this.notifyDownloadsChanged(true)
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
    const direct = join(directory, safeFilename)
    if (!existsSync(direct) && !this.reservedDownloadPaths.has(direct)) {
      this.reservedDownloadPaths.add(direct)
      return direct
    }
    const extension = extname(safeFilename)
    const stem = safeFilename.slice(0, safeFilename.length - extension.length)
    for (let index = 1; index <= 9_999; index += 1) {
      const suffix = ` (${index})${extension}`
      const characters = Array.from(stem)
      // Chromium's suggested name may already use the full filesystem limit.
      // Make room for the collision suffix without splitting a Unicode character.
      while (characters.length && Buffer.byteLength(characters.join('') + suffix) > 255) characters.pop()
      if (Buffer.byteLength(characters.join('') + suffix) > 255) break
      const candidate = join(directory, characters.join('') + suffix)
      if (existsSync(candidate) || this.reservedDownloadPaths.has(candidate)) continue
      this.reservedDownloadPaths.add(candidate)
      return candidate
    }
    throw new Error(`Could not allocate a unique download path for ${safeFilename}`)
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

import { lstat, readFile } from 'node:fs/promises'
import type { NavigationEntry } from 'electron'
import { normalizeDefaultFontSize } from '../../../shared/default-font-size.js'
import { restoreTabLabel } from '../../../shared/tab-label.js'
import { MAX_BROWSER_TABS, type BrowserClosedTabState, type BrowserWorkspaceNavigationPolicy } from '../../../shared/types.js'
import { writeTextFileAtomically } from '../../atomic-file.js'
import { isUuidV7 } from '../../uuid-v7.js'
import type { NavigationHistorySnapshot } from '../navigation-history.js'
import { savedTabHistory } from '../saved-tab-history/saved-tab-history.js'
import { normalizeTabTitle } from '../tab-metadata.js'
import { isAgentWorkspaceNavigationUrl } from '../url.js'
import { evaluateWorkspaceNavigation } from '../workspace-navigation-policy.js'

/** As many as Recently closed remembers. */
const MAX_SAVED_CLOSED_TABS = MAX_BROWSER_TABS
/** A closed tab whose address is longer, as a `data:` page can be, is not kept, as Chrome leaves out such an address. */
const MAX_CLOSED_TAB_URL_CHARS = 64 * 1024
/** As a closed tab keeps up to six pages on each side of the one it showed. */
const MAX_CLOSED_TAB_PAGES = 13
/** A saved Recently closed larger than all its tabs' pages can be is not read. */
const MAX_CLOSED_TABS_FILE_BYTES = 256 * 1024 * 1024
const CLOSED_TABS_VERSION = 1

/** A recently closed tab as the file keeps it: what Recently closed lists, and the history reopening it restores. */
export interface SavedClosedTab {
  closed: BrowserClosedTabState
  history?: NavigationHistorySnapshot
}

/** What saving Recently closed needs from the tab manager. */
export interface SavedClosedTabsAccess {
  /** The recently closed tabs, oldest first. */
  closedTabs(): readonly BrowserClosedTabState[]
  /** The history a closed tab restores when it reopens, if it has one. */
  closedTabHistory(closed: BrowserClosedTabState): NavigationHistorySnapshot | undefined
  /** The Site access rules of an open workspace, or undefined when it is not open. */
  navigationPolicy(workspaceId: string): BrowserWorkspaceNavigationPolicy | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a closed tab of a workspace can come back after a restart: one at an address its Site access rules allow. */
function reopenableAddress(url: string, policy: BrowserWorkspaceNavigationPolicy): boolean {
  return url.length <= MAX_CLOSED_TAB_URL_CHARS && isAgentWorkspaceNavigationUrl(url) && evaluateWorkspaceNavigation(policy, url).allowed
}

/**
 * The recently closed tabs a restart keeps, oldest first, as Chrome keeps them: those of open workspaces at an address
 * their Site access rules allow, each with the Back and Forward history a restart keeps of an open tab.
 */
export function savedClosedTabs(access: SavedClosedTabsAccess): SavedClosedTab[] {
  const saved: SavedClosedTab[] = []
  for (const closed of access.closedTabs().slice(-MAX_SAVED_CLOSED_TABS)) {
    const policy = closed.mcpGroupId ? access.navigationPolicy(closed.mcpGroupId) : undefined
    if (!policy || !reopenableAddress(closed.url, policy)) continue
    const history = savedTabHistory(access.closedTabHistory(closed), closed.url, policy)
    saved.push({ closed: { ...closed }, ...(history ? { history } : {}) })
  }
  return saved
}

/**
 * The closed tabs the file kept that can come back, oldest first: those of workspaces open again, at an address their
 * Site access rules allow now, with only the history those rules allow.
 */
export function restoredClosedTabs(
  saved: readonly SavedClosedTab[],
  navigationPolicy: (workspaceId: string) => BrowserWorkspaceNavigationPolicy | undefined
): SavedClosedTab[] {
  const restored: SavedClosedTab[] = []
  for (const { closed, history } of saved) {
    const policy = closed.mcpGroupId ? navigationPolicy(closed.mcpGroupId) : undefined
    if (!policy || !reopenableAddress(closed.url, policy)) continue
    const pages = savedTabHistory(history, closed.url, policy)
    restored.push({ closed, ...(pages ? { history: pages } : {}) })
  }
  return restored.slice(-MAX_SAVED_CLOSED_TABS)
}

function parsedHistory(value: unknown): NavigationHistorySnapshot | undefined {
  if (!isRecord(value) || !Array.isArray(value.entries)) return undefined
  const { entries, index } = value
  if (entries.length === 0 || entries.length > MAX_CLOSED_TAB_PAGES
    || typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= entries.length) return undefined
  const parsed: NavigationEntry[] = []
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.url !== 'string' || typeof entry.title !== 'string'
      || (entry.pageState !== undefined && typeof entry.pageState !== 'string')) return undefined
    parsed.push({ url: entry.url, title: entry.title, ...(entry.pageState ? { pageState: entry.pageState } : {}) })
  }
  return { entries: parsed, index }
}

/** A closed tab as the file holds it, or undefined when it is not one. */
function parsedClosedTab(value: unknown): SavedClosedTab | undefined {
  if (!isRecord(value) || !isRecord(value.closed)) return undefined
  const { id, title, label, url, pinned, closedAt, mcpGroupId, zoomIsolated, defaultFontSize, muted, tabAgentPaused, humanInteractionLocked, place } = value.closed
  if (typeof id !== 'string' || !isUuidV7(id) || typeof title !== 'string' || typeof url !== 'string' || typeof pinned !== 'boolean'
    || typeof closedAt !== 'string' || !Number.isFinite(Date.parse(closedAt)) || typeof mcpGroupId !== 'string'
    || (place !== undefined && (typeof place !== 'number' || !Number.isInteger(place) || place < 0 || place >= MAX_BROWSER_TABS))) return undefined
  const history = value.history === undefined ? undefined : parsedHistory(value.history)
  if (value.history !== undefined && !history) return undefined
  const restoredLabel = restoreTabLabel(label)
  const fontSize = normalizeDefaultFontSize(defaultFontSize)
  const closed: BrowserClosedTabState = {
    id,
    title: normalizeTabTitle(title, url),
    ...(restoredLabel ? { label: restoredLabel } : {}),
    url,
    pinned,
    closedAt: new Date(Date.parse(closedAt)).toISOString(),
    mcpGroupId,
    ...(zoomIsolated === true ? { zoomIsolated: true } : {}),
    ...(fontSize ? { defaultFontSize: fontSize } : {}),
    ...(muted === true ? { muted: true } : {}),
    ...(tabAgentPaused === true ? { tabAgentPaused: true } : {}),
    ...(humanInteractionLocked === true ? { humanInteractionLocked: true } : {}),
    ...(place !== undefined ? { place } : {})
  }
  return { closed, ...(history ? { history } : {}) }
}

/**
 * Recently closed, kept for the next start in the profile beside the saved tabs, as Chrome keeps it. A file that is
 * missing or cannot be read only loses it.
 */
export class ClosedTabsStore {
  private saveQueue: Promise<void> = Promise.resolve()
  private written: string | undefined

  constructor(private readonly path: string) {}

  /** The closed tabs the file kept, oldest first. */
  async load(): Promise<SavedClosedTab[]> {
    let contents: string
    try {
      // lstat refuses a link, which the profile never holds here.
      const entry = await lstat(this.path)
      if (!entry.isFile() || entry.size > MAX_CLOSED_TABS_FILE_BYTES) throw new Error('Not a saved Recently closed')
      contents = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[browser] The saved recently closed tabs could not be read; Recently closed starts empty.')
      return []
    }
    try {
      const data = JSON.parse(contents) as unknown
      if (!isRecord(data) || data.version !== CLOSED_TABS_VERSION || !Array.isArray(data.closedTabs)) throw new Error('Not a saved Recently closed')
      const saved = data.closedTabs.slice(-MAX_SAVED_CLOSED_TABS).flatMap((value) => parsedClosedTab(value) ?? [])
      this.written = contents
      return saved
    } catch {
      console.warn('[browser] The saved recently closed tabs could not be read; Recently closed starts empty.')
      return []
    }
  }

  /**
   * Saves the closed tabs, taken when the save's turn comes, unless they are what the file holds already. Nothing is
   * saved when none are given, as once the browser closes.
   */
  save(closedTabs: () => readonly SavedClosedTab[] | undefined): Promise<void> {
    const operation = this.saveQueue.then(async () => {
      const current = closedTabs()
      if (!current) return
      const contents = `${JSON.stringify({ version: CLOSED_TABS_VERSION, closedTabs: current })}\n`
      if (contents === this.written) return
      await writeTextFileAtomically(this.path, contents, 0o600)
      this.written = contents
    })
    this.saveQueue = operation.catch(() => undefined)
    return operation
  }
}

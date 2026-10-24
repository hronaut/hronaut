import { lstat, readFile } from 'node:fs/promises'
import type { NavigationEntry } from 'electron'
import type { BrowserWorkspaceNavigationPolicy } from '../../../shared/types.js'
import { writeTextFileAtomically } from '../../atomic-file.js'
import { isUuidV7 } from '../../uuid-v7.js'
import type { NavigationHistorySnapshot } from '../navigation-history.js'
import { MAX_TAB_TITLE_CHARS } from '../tab-metadata.js'
import { isAgentWorkspaceNavigationUrl } from '../url.js'
import { evaluateWorkspaceNavigation } from '../workspace-navigation-policy.js'

/** As in Chrome, a restart keeps up to six pages on each side of the page a tab shows. */
const MAX_SAVED_PAGES_EACH_SIDE = 6
/** As in Chrome, a page's saved scroll and form state is left out when it is larger than 64 KiB. */
const MAX_SAVED_PAGE_STATE_BYTES = 64 * 1024
const MAX_SAVED_PAGE_STATE_CHARS = Math.ceil(MAX_SAVED_PAGE_STATE_BYTES / 3) * 4
/** A page whose address is longer, as a `data:` page can be, is left out, as Chrome leaves out its address. */
const MAX_SAVED_PAGE_URL_CHARS = 64 * 1024
/** A saved history larger than all its tabs' pages can be is not read. */
const MAX_TAB_HISTORY_FILE_BYTES = 256 * 1024 * 1024
const TAB_HISTORY_VERSION = 1
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/**
 * The encodings a form sends its fields in. A page a form posted to keeps the fields, passwords included, in its saved
 * state, with the encoding as its content type, which Chromium writes in UTF-16, so such a page's state is not saved;
 * Chrome takes the passwords out of it instead. A page's own form fields are saved without passwords.
 */
const FORM_ENCODINGS = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']
  .flatMap((encoding) => [Buffer.from(encoding, 'utf16le'), Buffer.from(encoding, 'latin1')])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a restart keeps a page of a workspace tab's history: one its Site access rules let it open. */
function savedPage(url: string, policy: BrowserWorkspaceNavigationPolicy): boolean {
  return url.length <= MAX_SAVED_PAGE_URL_CHARS
    && isAgentWorkspaceNavigationUrl(url)
    && evaluateWorkspaceNavigation(policy, url).allowed
}

/**
 * The scroll and form state a restart keeps of a page, unless it is too large or holds the fields a form posted. The
 * state names the page's address, in UTF-16 as Chromium writes it, which is the address Electron opens again: a state
 * that does not name the page's own is left out.
 */
function savedPageState(url: string, pageState: string | undefined): string | undefined {
  if (!pageState || pageState.length > MAX_SAVED_PAGE_STATE_CHARS || !BASE64.test(pageState)) return undefined
  const bytes = Buffer.from(pageState, 'base64')
  if (bytes.length > MAX_SAVED_PAGE_STATE_BYTES || !bytes.includes(Buffer.from(url, 'utf16le'))) return undefined
  return FORM_ENCODINGS.some((encoding) => bytes.includes(encoding)) ? undefined : pageState
}

/**
 * The Back and Forward history a restart keeps of a workspace tab, as Chrome does: up to six pages on each side of the
 * page it shows, with their titles and scroll and form state, without the pages its Site access rules do not let it
 * open. None when the history does not show the tab's address, as while its first page loads, or holds nothing more
 * than that address, so the tab opens its address.
 */
export function savedTabHistory(
  history: NavigationHistorySnapshot | undefined,
  url: string,
  policy: BrowserWorkspaceNavigationPolicy
): NavigationHistorySnapshot | undefined {
  if (!history || history.entries[history.index]?.url !== url || !savedPage(url, policy)) return undefined
  const first = Math.max(0, history.index - MAX_SAVED_PAGES_EACH_SIDE)
  const last = Math.min(history.entries.length - 1, history.index + MAX_SAVED_PAGES_EACH_SIDE)
  const entries: NavigationEntry[] = []
  let index = 0
  for (let entryIndex = first; entryIndex <= last; entryIndex += 1) {
    const entry = history.entries[entryIndex]!
    if (entryIndex !== history.index && !savedPage(entry.url, policy)) continue
    if (entryIndex === history.index) index = entries.length
    const pageState = savedPageState(entry.url, entry.pageState)
    entries.push({ url: entry.url, title: entry.title.slice(0, MAX_TAB_TITLE_CHARS), ...(pageState ? { pageState } : {}) })
  }
  return entries.length > 1 || entries[0]!.pageState ? { entries, index } : undefined
}

/** What reading a page's history needs: Electron's navigation history of the page. */
export interface PageNavigationHistory {
  length(): number
  getActiveIndex(): number
  getEntryAtIndex(index: number): NavigationEntry | null
}

/**
 * The pages of a page's history a restart can keep, read only around the page it shows, or undefined when it cannot be
 * read, as once the page is gone.
 */
export function historyAroundShownPage(history: PageNavigationHistory): NavigationHistorySnapshot | undefined {
  try {
    const shown = history.getActiveIndex()
    const length = history.length()
    if (shown < 0 || shown >= length) return undefined
    const first = Math.max(0, shown - MAX_SAVED_PAGES_EACH_SIDE)
    const last = Math.min(length - 1, shown + MAX_SAVED_PAGES_EACH_SIDE)
    const entries: NavigationEntry[] = []
    for (let index = first; index <= last; index += 1) {
      const entry = history.getEntryAtIndex(index)
      if (!entry) return undefined
      entries.push(entry)
    }
    return { entries, index: shown - first }
  } catch {
    // Electron can destroy the page between the calls.
    return undefined
  }
}

/** A tab whose history a restart keeps. */
export interface SavedTabHistoryTab {
  id: string
  url: string
  mcpGroupId?: string
}

/** What saving the tabs' history needs from the tab manager. */
export interface SavedTabHistoryAccess<Tab extends SavedTabHistoryTab> {
  /** The open tabs. */
  tabs(): Iterable<Tab>
  /** A tab's history around the page it shows, without the sleeping page, or undefined when it cannot be read. */
  navigationHistory(tab: Tab): NavigationHistorySnapshot | undefined
  /** The Site access rules of an open workspace, or undefined when it is not open. */
  navigationPolicy(workspaceId: string): BrowserWorkspaceNavigationPolicy | undefined
}

/**
 * The history a restart keeps of each workspace tab, by tab. A tab whose history does not show its address, as while
 * it goes Back or Forward or wakes, keeps the history saved before, which still has to show its address.
 */
export function savedTabHistories<Tab extends SavedTabHistoryTab>(
  access: SavedTabHistoryAccess<Tab>,
  previous: ReadonlyMap<string, NavigationHistorySnapshot>
): Map<string, NavigationHistorySnapshot> {
  const histories = new Map<string, NavigationHistorySnapshot>()
  for (const tab of access.tabs()) {
    const policy = tab.mcpGroupId ? access.navigationPolicy(tab.mcpGroupId) : undefined
    if (!policy) continue
    const live = access.navigationHistory(tab)
    const shown = live?.entries[live.index]?.url === tab.url ? live : previous.get(tab.id)
    const history = savedTabHistory(shown, tab.url, policy)
    if (history) histories.set(tab.id, history)
  }
  return histories
}

/** A saved history without the pages that clearing the history forgot, as open tabs forget them, but with the page the tab shows. */
function withoutForgottenPages(history: NavigationHistorySnapshot, matches: (url: string) => boolean): NavigationHistorySnapshot {
  return {
    entries: history.entries.filter((entry, index) => index === history.index || !matches(entry.url)),
    index: history.entries.slice(0, history.index).filter((entry) => !matches(entry.url)).length
  }
}

/** A tab's history as the file holds it, or undefined when it is not one. */
function parsedTabHistory(value: unknown): NavigationHistorySnapshot | undefined {
  if (!isRecord(value) || !Array.isArray(value.entries)) return undefined
  const { entries, index } = value
  if (entries.length === 0 || entries.length > MAX_SAVED_PAGES_EACH_SIDE * 2 + 1
    || typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= entries.length) return undefined
  const parsed: NavigationEntry[] = []
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.url !== 'string' || typeof entry.title !== 'string'
      || (entry.pageState !== undefined && typeof entry.pageState !== 'string')) return undefined
    parsed.push({ url: entry.url, title: entry.title, ...(entry.pageState ? { pageState: entry.pageState } : {}) })
  }
  return { entries: parsed, index }
}

/**
 * The tabs' Back and Forward history, kept for the next start in the profile beside the saved tabs, as Chrome keeps
 * it in its session. A file that is missing or cannot be read only loses that history: the tabs open their addresses.
 */
export class TabHistoryStore {
  private saveQueue: Promise<void> = Promise.resolve()
  private written: string | undefined
  /** The history of each tab as last read or saved, which a tab whose history cannot be read keeps. */
  private saved: Map<string, NavigationHistorySnapshot> = new Map()

  constructor(private readonly path: string) {}

  /** The saved history of each tab, by tab. */
  async load(): Promise<Map<string, NavigationHistorySnapshot>> {
    const histories = new Map<string, NavigationHistorySnapshot>()
    let contents: string
    try {
      // lstat refuses a link, which the profile never holds here.
      const entry = await lstat(this.path)
      if (!entry.isFile() || entry.size > MAX_TAB_HISTORY_FILE_BYTES) throw new Error('Not a saved tab history')
      contents = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[browser] The saved tab history could not be read; tabs open without Back and Forward history.')
      return histories
    }
    try {
      const data = JSON.parse(contents) as unknown
      if (!isRecord(data) || data.version !== TAB_HISTORY_VERSION || !isRecord(data.tabs)) throw new Error('Not a saved tab history')
      for (const [tabId, value] of Object.entries(data.tabs)) {
        const history = parsedTabHistory(value)
        if (history && isUuidV7(tabId)) histories.set(tabId, history)
      }
      this.written = contents
      this.saved = new Map(histories)
    } catch {
      console.warn('[browser] The saved tab history could not be read; tabs open without Back and Forward history.')
    }
    return histories
  }

  /**
   * Saves the history of each tab, taken when the save's turn comes from the history saved before, unless it is what
   * the file holds already. Nothing is saved when no history is given, as once the browser closes.
   */
  save(histories: (previous: ReadonlyMap<string, NavigationHistorySnapshot>) => ReadonlyMap<string, NavigationHistorySnapshot> | undefined): Promise<void> {
    const operation = this.saveQueue.then(async () => {
      const current = histories(this.saved)
      if (!current) return
      this.saved = new Map(current)
      const contents = `${JSON.stringify({ version: TAB_HISTORY_VERSION, tabs: Object.fromEntries(current) })}\n`
      if (contents === this.written) return
      await writeTextFileAtomically(this.path, contents, 0o600)
      this.written = contents
    })
    this.saveQueue = operation.catch(() => undefined)
    return operation
  }

  /**
   * Forgets the pages that clearing the history forgot in the history saved before of the tabs it cleared, so a tab
   * whose history cannot be read when it is saved next does not bring them back.
   */
  forgetPages(matches: (url: string) => boolean, tabIds: ReadonlySet<string> | undefined): void {
    for (const [tabId, history] of this.saved) {
      if (!tabIds || tabIds.has(tabId)) this.saved.set(tabId, withoutForgottenPages(history, matches))
    }
  }
}

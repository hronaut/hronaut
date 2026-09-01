import { readFile } from 'node:fs/promises'
import { isBrowserTabGroupColor, type BrowserTabGroupColor } from '../../shared/tab-groups.js'
import {
  isBrowserSplitOrientation,
  normalizeSplitViewRatio,
  type BrowserSplitViewState
} from '../../shared/split-view.js'
import { isUuidV7 } from '../uuid-v7.js'
import { writeTextFileAtomically } from '../atomic-file.js'
import { normalizeTabTitle } from './tab-metadata.js'
import { isAgentWorkspaceNavigationUrl } from './url.js'

export const TAB_STATE_VERSION = 2 as const

export interface PersistedTab {
  id: string
  title: string
  url: string
  pinned?: boolean
  humanInteractionLocked?: boolean
  mcpGroupId?: string
}

export interface PersistedTabGroup {
  id: string
  name: string
  color: BrowserTabGroupColor
  createdAt: string
  lastUsedAt: string
  activeTabId?: string | null
  storageId?: string
  origins?: string[]
}

export interface PersistedSavedTabGroup {
  id: string
  name: string
  color: BrowserTabGroupColor
  savedAt: string
  storageId?: string
  origins?: string[]
  tabs: Array<Pick<PersistedTab, 'title' | 'url' | 'pinned'>>
}

export interface PersistedBrowserState {
  version: typeof TAB_STATE_VERSION
  activeTabId: string | null
  splitView?: BrowserSplitViewState
  allHumanInteractionLocked?: boolean
  defaultHumanGroupId?: string
  tabs: PersistedTab[]
  mcpTabGroups?: PersistedTabGroup[]
  savedTabGroups?: PersistedSavedTabGroup[]
}

const WORKSPACE_STORAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HRONAUT_HOME_URL = 'hronaut://home/'
const MAX_TABS = 50
const MAX_ACTIVE_WORKSPACES = 50
const MAX_SAVED_WORKSPACES = 50
const MAX_WORKSPACE_NAME_LENGTH = 80

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function workspaceNameKey(name: string): string {
  return name.normalize('NFKC').toLowerCase()
}

function persistedWorkspaceOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const origins = new Set<string>()
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue
    try {
      const url = new URL(candidate)
      if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname) origins.add(url.origin)
    } catch {
      // Ignore corrupt or obsolete profile entries while preserving the rest.
    }
  }
  return [...origins].sort()
}

function persistedWorkspaceStorageId(value: unknown): string | undefined {
  return typeof value === 'string' && WORKSPACE_STORAGE_ID_PATTERN.test(value) ? value : undefined
}

function normalizePersistedTabUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const viewSourcePrefix = 'view-source:'
  const isViewSource = value.toLowerCase().startsWith(viewSourcePrefix)
  const source = isViewSource ? value.slice(viewSourcePrefix.length) : value
  if (!source || source.toLowerCase().startsWith(viewSourcePrefix)) return null
  try {
    const url = new URL(source)
    const hasEmbeddedHttpCredentials = (url.protocol === 'http:' || url.protocol === 'https:')
      && (url.username || url.password)
    const normalizedSource = hasEmbeddedHttpCredentials
      ? (() => {
          url.username = ''
          url.password = ''
          return url.href
        })()
      : source
    return isViewSource ? `${viewSourcePrefix}${normalizedSource}` : normalizedSource
  } catch {
    return null
  }
}

function sanitizePersistedStateUrls(state: PersistedBrowserState): PersistedBrowserState {
  const sanitizeTab = <T extends { title: string; url: string }>(tab: T, agentOwned: boolean): T => {
    const originalUrl = tab.url
    const normalized = normalizePersistedTabUrl(originalUrl)
    if (!normalized) throw new TypeError('Persisted tab URL must be an absolute URL')
    const url = agentOwned && !isAgentWorkspaceNavigationUrl(normalized) ? 'about:blank' : normalized
    return {
      ...tab,
      title: url !== normalized ? 'New tab' : tab.title === originalUrl ? normalized : tab.title,
      url
    }
  }
  return {
    ...state,
    tabs: state.tabs.map((tab) => sanitizeTab(
      tab,
      tab.mcpGroupId !== undefined && tab.mcpGroupId !== state.defaultHumanGroupId
    )),
    savedTabGroups: state.savedTabGroups?.map((group) => ({
      ...group,
      tabs: group.tabs.map((tab) => sanitizeTab(tab, true))
    }))
  }
}

export class TabStateStore {
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async load(): Promise<PersistedBrowserState | null> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      if (!isRecord(parsed)) return null
      const data = parsed
      if (
        data.version !== TAB_STATE_VERSION
        || !Array.isArray(data.tabs)
        || !Array.isArray(data.mcpTabGroups)
        || !Array.isArray(data.savedTabGroups)
        || data.tabs.length > MAX_TABS
        || data.mcpTabGroups.length > MAX_ACTIVE_WORKSPACES
        || data.savedTabGroups.length > MAX_SAVED_WORKSPACES
        || typeof data.defaultHumanGroupId !== 'string'
        || !isUuidV7(data.defaultHumanGroupId)
      ) return null

      const usedWorkspaceIds = new Set<string>()
      const activeWorkspaceIds = new Set<string>()
      const usedStorageIds = new Set<string>()
      let repairedPersistedState = false
      const mcpTabGroups: PersistedTabGroup[] = []
      for (const candidate of data.mcpTabGroups) {
        if (!isRecord(candidate)) return null
        const storageId = persistedWorkspaceStorageId(candidate.storageId)
        if (
          typeof candidate.id !== 'string'
          || !isUuidV7(candidate.id)
          || usedWorkspaceIds.has(candidate.id)
          || typeof candidate.name !== 'string'
          || candidate.name !== candidate.name.trim().normalize('NFC')
          || !candidate.name
          || candidate.name.length > MAX_WORKSPACE_NAME_LENGTH
          || !isBrowserTabGroupColor(candidate.color)
          || typeof candidate.createdAt !== 'string'
          || typeof candidate.lastUsedAt !== 'string'
          || (candidate.activeTabId !== null && candidate.activeTabId !== undefined && typeof candidate.activeTabId !== 'string')
          || (candidate.id === data.defaultHumanGroupId
            ? candidate.name !== 'Default' || storageId !== undefined
            : storageId === undefined || workspaceNameKey(candidate.name) === workspaceNameKey('Default'))
          || (storageId !== undefined && usedStorageIds.has(storageId))
        ) return null
        usedWorkspaceIds.add(candidate.id)
        activeWorkspaceIds.add(candidate.id)
        if (storageId) usedStorageIds.add(storageId)
        mcpTabGroups.push({
          id: candidate.id,
          name: candidate.name,
          color: candidate.color,
          createdAt: candidate.createdAt,
          lastUsedAt: candidate.lastUsedAt,
          activeTabId: typeof candidate.activeTabId === 'string' ? candidate.activeTabId : null,
          ...(storageId ? { storageId } : {}),
          origins: persistedWorkspaceOrigins(candidate.origins)
        })
      }
      if (!usedWorkspaceIds.has(data.defaultHumanGroupId)) return null

      const savedTabGroups: PersistedSavedTabGroup[] = []
      for (const candidate of data.savedTabGroups) {
        if (!isRecord(candidate) || !Array.isArray(candidate.tabs)) return null
        const storageId = persistedWorkspaceStorageId(candidate.storageId)
        if (
          typeof candidate.id !== 'string'
          || !isUuidV7(candidate.id)
          || usedWorkspaceIds.has(candidate.id)
          || typeof candidate.name !== 'string'
          || candidate.name !== candidate.name.trim().normalize('NFC')
          || !candidate.name
          || candidate.name.length > MAX_WORKSPACE_NAME_LENGTH
          || workspaceNameKey(candidate.name) === workspaceNameKey('Default')
          || !isBrowserTabGroupColor(candidate.color)
          || typeof candidate.savedAt !== 'string'
          || !storageId
          || usedStorageIds.has(storageId)
          || candidate.tabs.length === 0
          || candidate.tabs.length > MAX_TABS
          || candidate.tabs.some((tab) => (
            !isRecord(tab)
            || typeof tab.title !== 'string'
            || normalizePersistedTabUrl(tab.url) === null
          ))
        ) return null
        usedWorkspaceIds.add(candidate.id)
        usedStorageIds.add(storageId)
        savedTabGroups.push({
          id: candidate.id,
          name: candidate.name,
          color: candidate.color,
          savedAt: candidate.savedAt,
          storageId,
          origins: persistedWorkspaceOrigins(candidate.origins),
          tabs: candidate.tabs.map((tab) => {
            const originalUrl = (tab as Record<string, unknown>).url as string
            const normalizedUrl = normalizePersistedTabUrl(originalUrl)!
            const url = isAgentWorkspaceNavigationUrl(normalizedUrl) ? normalizedUrl : 'about:blank'
            const title = (tab as Record<string, unknown>).title as string
            if (url !== originalUrl) repairedPersistedState = true
            return {
              title: url !== normalizedUrl
                ? 'New tab'
                : normalizeTabTitle(title === originalUrl ? url : title, url),
              url,
              pinned: (tab as Record<string, unknown>).pinned === true
            }
          })
        })
      }

      const usedTabIds = new Set<string>()
      const tabs: PersistedTab[] = []
      for (const candidate of data.tabs) {
        const url = isRecord(candidate) ? normalizePersistedTabUrl(candidate.url) : null
        if (
          !isRecord(candidate)
          || typeof candidate.id !== 'string'
          || !isUuidV7(candidate.id)
          || usedTabIds.has(candidate.id)
          || typeof candidate.title !== 'string'
          || url === null
          || (candidate.mcpGroupId !== undefined
            && (typeof candidate.mcpGroupId !== 'string' || !activeWorkspaceIds.has(candidate.mcpGroupId)))
          || (candidate.mcpGroupId === undefined && url !== HRONAUT_HOME_URL)
        ) return null
        const normalizedUrl = typeof candidate.mcpGroupId === 'string'
          && candidate.mcpGroupId !== data.defaultHumanGroupId
          && !isAgentWorkspaceNavigationUrl(url)
          ? 'about:blank'
          : url
        if (normalizedUrl !== candidate.url) repairedPersistedState = true
        usedTabIds.add(candidate.id)
        tabs.push({
          id: candidate.id,
          title: normalizedUrl !== url
            ? 'New tab'
            : normalizeTabTitle(candidate.title === candidate.url ? normalizedUrl : candidate.title, normalizedUrl),
          url: normalizedUrl,
          pinned: candidate.pinned === true,
          humanInteractionLocked: candidate.humanInteractionLocked === true,
          ...(typeof candidate.mcpGroupId === 'string' ? { mcpGroupId: candidate.mcpGroupId } : {})
        })
      }
      const activeTabId = typeof data.activeTabId === 'string' ? data.activeTabId : null
      if (activeTabId !== null && !usedTabIds.has(activeTabId)) return null
      for (const group of mcpTabGroups) {
        if (group.activeTabId && !tabs.some((tab) => tab.id === group.activeTabId && tab.mcpGroupId === group.id)) return null
      }

      const splitView = isRecord(data.splitView)
        && typeof data.splitView.firstTabId === 'string'
        && typeof data.splitView.secondTabId === 'string'
        && data.splitView.firstTabId !== data.splitView.secondTabId
        && usedTabIds.has(data.splitView.firstTabId)
        && usedTabIds.has(data.splitView.secondTabId)
        && isBrowserSplitOrientation(data.splitView.orientation)
        && typeof data.splitView.ratio === 'number'
        ? {
            firstTabId: data.splitView.firstTabId,
            secondTabId: data.splitView.secondTabId,
            orientation: data.splitView.orientation,
            ratio: normalizeSplitViewRatio(data.splitView.ratio)
          }
        : undefined
      if (data.splitView !== undefined && !splitView) return null

      const restored: PersistedBrowserState = {
        version: TAB_STATE_VERSION,
        activeTabId: typeof data.activeTabId === 'string' ? data.activeTabId : null,
        ...(splitView ? { splitView } : {}),
        allHumanInteractionLocked: data.allHumanInteractionLocked === true,
        defaultHumanGroupId: data.defaultHumanGroupId,
        mcpTabGroups,
        savedTabGroups,
        tabs
      }
      if (repairedPersistedState) await this.save(restored)
      return restored
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      return null
    }
  }

  save(state: PersistedBrowserState): Promise<void> {
    const contents = `${JSON.stringify(sanitizePersistedStateUrls(state), null, 2)}\n`
    const operation = this.saveQueue.then(async () => {
      await writeTextFileAtomically(this.path, contents)
    })
    this.saveQueue = operation.catch(() => undefined)
    return operation
  }
}

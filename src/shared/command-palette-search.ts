import { labelMatchScore } from './command-palette.js'
import { isHronautHomeUrl } from './home-url.js'
import type { BrowserHistoryEntry, BrowserTabGroupColor, BrowserTabGroupState, BrowserTabState } from './types.js'
import { workspaceSiteHost } from './workspace-switcher.js'

/** What the palette finds besides commands, in the order its sections show when they match equally well. */
export type CommandPaletteResultKind = 'tabs' | 'workspaces' | 'settings' | 'history'

/** How many of each the palette lists, so commands stay in reach below them. */
export const COMMAND_PALETTE_RESULT_LIMITS: Readonly<Record<CommandPaletteResultKind, number>> = {
  tabs: 5,
  workspaces: 4,
  settings: 3,
  history: 5
}

/** A match only in an address or a description, which ranks below any match in a name. */
export const DETAIL_MATCH_SCORE = 5

export interface CommandPaletteResult {
  kind: CommandPaletteResultKind
  /** The tab, workspace, settings section or history entry; unique within its kind. */
  id: string
  /** Page titles and workspace names come from websites and people: render as text only. */
  label: string
  description: string
  /** How well its name matches, as labelMatchScore, or DETAIL_MATCH_SCORE for a match elsewhere. */
  score: number
  /** The color of a workspace, or of a tab's workspace. */
  color?: BrowserTabGroupColor
}

export interface CommandPaletteResultSection {
  id: CommandPaletteResultKind
  results: CommandPaletteResult[]
}

function searchWords(query: string): string[] {
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
}

function matchesEvery(text: string, words: readonly string[]): boolean {
  const normalized = text.toLocaleLowerCase()
  return words.every((word) => normalized.includes(word))
}

function scored(name: string, query: string): number {
  return labelMatchScore(name, query) || DETAIL_MATCH_SCORE
}

/** The best matches first, keeping the source order among equals. */
function best<T extends { score: number }>(results: readonly T[], limit: number): T[] {
  return results
    .map((result, index) => ({ result, index }))
    .sort((left, right) => right.result.score - left.result.score || left.index - right.index)
    .slice(0, limit)
    .map(({ result }) => result)
}

/** A website's host and path, without its query or fragment, or nothing for other pages. */
export function paletteAddress(url: string): string {
  const host = workspaceSiteHost(url)
  if (!host) return ''
  try {
    const path = new URL(url).pathname
    return path === '/' ? host : `${host}${path}`
  } catch {
    return host
  }
}

export interface PaletteTabSource {
  activeTabId: string | null
  tabs: readonly Pick<BrowserTabState, 'id' | 'title' | 'url' | 'mcpGroupId'>[]
  mcpTabGroups: readonly Pick<BrowserTabGroupState, 'id' | 'name' | 'color'>[]
}

/** Open tabs other than the one in view and Home, matched by title and address. */
export function searchPaletteTabs(source: PaletteTabSource, query: string, untitled: string): CommandPaletteResult[] {
  const words = searchWords(query)
  if (!words.length) return []
  const groups = new Map(source.mcpTabGroups.map((group) => [group.id, group]))
  const results: CommandPaletteResult[] = []
  for (const tab of source.tabs) {
    if (tab.id === source.activeTabId || isHronautHomeUrl(tab.url)) continue
    const address = paletteAddress(tab.url)
    const title = tab.title.trim() || address || untitled
    if (!matchesEvery(`${title} ${address}`, words)) continue
    const group = tab.mcpGroupId ? groups.get(tab.mcpGroupId) : undefined
    results.push({
      kind: 'tabs',
      id: tab.id,
      label: title,
      description: [address, group?.name].filter(Boolean).join(' · '),
      score: scored(title, query),
      ...(group ? { color: group.color } : {})
    })
  }
  return best(results, COMMAND_PALETTE_RESULT_LIMITS.tabs)
}

/**
 * Visited pages matched by title and address, the most recent first among equals. Pages open in a tab are left to
 * the tab results, and an address is listed once.
 */
export function searchPaletteHistory(
  entries: readonly BrowserHistoryEntry[],
  openUrls: ReadonlySet<string>,
  query: string
): CommandPaletteResult[] {
  const words = searchWords(query)
  if (!words.length) return []
  const seen = new Set<string>()
  const results: CommandPaletteResult[] = []
  const recent = [...entries].sort((left, right) => Date.parse(right.visitedAt) - Date.parse(left.visitedAt) || 0)
  for (const entry of recent) {
    if (openUrls.has(entry.url) || seen.has(entry.url)) continue
    const address = paletteAddress(entry.url)
    if (!address) continue
    const title = entry.title.trim() || address
    if (!matchesEvery(`${title} ${address}`, words)) continue
    seen.add(entry.url)
    results.push({ kind: 'history', id: entry.id, label: title, description: address, score: scored(title, query) })
  }
  return best(results, COMMAND_PALETTE_RESULT_LIMITS.history)
}

export interface PaletteSettingsItem {
  section: string
  label: string
  description: string
}

/** Settings sections matched by their name and description, as Settings' own search matches them. */
export function searchPaletteSettings(items: readonly PaletteSettingsItem[], query: string): CommandPaletteResult[] {
  const words = searchWords(query)
  if (!words.length) return []
  return best(items
    .filter((item) => matchesEvery(`${item.label} ${item.description}`, words))
    .map((item) => ({ kind: 'settings' as const, id: item.section, label: item.label, description: item.description, score: scored(item.label, query) })),
  COMMAND_PALETTE_RESULT_LIMITS.settings)
}

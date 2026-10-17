import { computed, type Ref } from 'vue'
import type { AgentPresenceSnapshot } from '../../../shared/agent-presence.js'
import { labelMatchScore } from '../../../shared/command-palette.js'
import {
  COMMAND_PALETTE_RESULT_LIMITS,
  DETAIL_MATCH_SCORE,
  searchPaletteHistory,
  searchPaletteSettings,
  searchPaletteTabs,
  type CommandPaletteResult,
  type CommandPaletteResultSection
} from '../../../shared/command-palette-search.js'
import type { BrowserHistoryEntry, BrowserState, UserAttentionRequest } from '../../../shared/types.js'
import { filterWorkspaceSwitcherEntries, workspaceSwitcherEntries, type WorkspaceSwitcherEntry } from '../../../shared/workspace-switcher.js'
import { SETTINGS_NAVIGATION } from '../settings-navigation.js'
import { goToTab, goToWorkspace, type WorkspaceNavigation } from '../workspace-navigation.js'
import type { SettingsSection } from './useSettingsDialogController.js'

type Translate = (key: string, parameters?: Record<string, unknown>, plural?: number) => string

export interface CommandPaletteSearchOptions extends Omit<WorkspaceNavigation, 'state'> {
  state: Readonly<Ref<BrowserState>>
  history: Readonly<Ref<readonly BrowserHistoryEntry[]>>
  userAttention: Readonly<Ref<Pick<UserAttentionRequest, 'tabId' | 'workspaceId'> | null | undefined>>
  /** Agents seen in each workspace; without it, workspaces show no agent status. */
  presence?: Readonly<Ref<AgentPresenceSnapshot>>
  translate: Translate
  formatNumber: (value: number) => string
  formatError: (cause: unknown, fallback: string) => string
  showError: (title: string, message: string) => void
  openHistoryEntry: (entry: BrowserHistoryEntry) => Promise<unknown>
  openSettingsSection: (section: SettingsSection) => unknown
}

/**
 * What the command palette finds besides commands, in this window: open tabs, workspaces, Settings' sections and
 * locally visited pages, and how it goes to each. Everything is matched here from state the window already has.
 */
export function useCommandPaletteSearch(options: CommandPaletteSearchOptions) {
  const t = options.translate
  const workspaces = computed(() => workspaceSwitcherEntries(
    options.state.value,
    options.presence?.value.workspaces ?? {},
    options.userAttention.value,
    t('shell.agents.unnamed')
  ))
  const settings = computed(() => SETTINGS_NAVIGATION.map((item) => ({
    section: item.section,
    label: t(item.labelKey),
    description: t(item.descriptionKey)
  })))
  const openUrls = computed(() => new Set(options.state.value.tabs.map((tab) => tab.url)))
  // Each choice is newer than the one before; only the newest one reports a failure.
  let choice = 0

  function workspaceDescription(entry: WorkspaceSwitcherEntry): string {
    const status = entry.status === 'needs-you'
      ? t('workspaceSwitcher.needsYou')
      : entry.status === 'working' ? t('workspaceSwitcher.working', { names: entry.workingAgents.slice(0, 2).join(', ') }) : ''
    return [
      status,
      entry.kind === 'archived' ? t('workspaceSwitcher.archived') : '',
      t('workspaceSwitcher.tabs', { count: options.formatNumber(entry.tabCount) }, entry.tabCount),
      entry.sites.slice(0, 2).join(' · ')
    ].filter(Boolean).join(' · ')
  }

  function searchWorkspaces(query: string): CommandPaletteResult[] {
    return filterWorkspaceSwitcherEntries(workspaces.value.filter((entry) => !entry.current), query)
      .slice(0, COMMAND_PALETTE_RESULT_LIMITS.workspaces)
      .map((entry) => ({
        kind: 'workspaces',
        id: `${entry.kind}:${entry.id}`,
        label: entry.name,
        description: workspaceDescription(entry),
        score: labelMatchScore(entry.name, query) || DETAIL_MATCH_SCORE,
        color: entry.color
      }))
  }

  function search(query: string): CommandPaletteResultSection[] {
    if (!query.trim()) return []
    const state = options.state.value
    return [
      { id: 'tabs' as const, results: searchPaletteTabs(state, query, t('commandPalette.untitledTab')) },
      { id: 'workspaces' as const, results: searchWorkspaces(query) },
      { id: 'settings' as const, results: searchPaletteSettings(settings.value, query) },
      { id: 'history' as const, results: searchPaletteHistory(options.history.value, openUrls.value, query) }
    ].filter((section) => section.results.length)
  }

  function navigation(): WorkspaceNavigation {
    return { ...options, state: options.state.value }
  }

  /** Goes to a result; false when it is gone, such as a tab an agent closed after the list was drawn. */
  async function goToResult(result: CommandPaletteResult): Promise<boolean> {
    if (result.kind === 'tabs') return goToTab(result.id, navigation())
    if (result.kind === 'workspaces') {
      const separator = result.id.indexOf(':')
      const kind = result.id.slice(0, separator) === 'archived' ? 'archived' : 'open'
      return goToWorkspace({ kind, id: result.id.slice(separator + 1) }, navigation())
    }
    if (result.kind === 'settings') {
      await options.openSettingsSection(result.id as SettingsSection)
      return true
    }
    const entry = options.history.value.find((candidate) => candidate.id === result.id)
    if (entry) await options.openHistoryEntry(entry)
    return Boolean(entry)
  }

  /** Goes to a result. A failure is shown unless the person has chosen something newer meanwhile. */
  async function open(result: CommandPaletteResult): Promise<void> {
    const current = ++choice
    const title = t('commandPalette.openFailed', { name: result.label })
    const description = t('commandPalette.openFailedDescription')
    try {
      if (!(await goToResult(result)) && current === choice) options.showError(title, description)
    } catch (cause) {
      if (current === choice) options.showError(title, options.formatError(cause, description))
    }
  }

  return { search, open }
}

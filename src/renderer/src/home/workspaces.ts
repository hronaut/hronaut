import type { AgentStepKind } from '../../../shared/agent-steps.js'
import type { HomeBootstrap, HomeDashboard, HomeFeedEntry, HronautHomeApi } from '../../../shared/home.js'
import type { HomeWorkspaceAction, HomeWorkspaceState } from '../../../shared/home-workspaces.js'
import { MAX_ARCHIVED_WORKSPACES } from '../../../shared/undo.js'
import { agentStepText } from '../../../shared/agent-step-text.js'
import { tabTitleForDisplay } from '../../../shared/tab-title.js'
import { mountActivityFeed } from './activity-feed.js'
import { element, errorText, interpolate, messageAt, pluralText, timeAgo } from './dom.js'
import { renderNewWorkspaceTile, renderWorkspaceCard, renderWorkspaceEmpty, updateCardStatus, type CardStatus } from './workspace-card.js'

type LiveAgents = Pick<HomeDashboard, 'agents' | 'workspaceActivity' | 'feed'>

export function mountWorkspaces(data: HomeBootstrap, api: HronautHomeApi, signal: AbortSignal, onStateChange?: (state: HomeWorkspaceState) => void) {
  let state = data.workspaces
  let live: LiveAgents = data.dashboard
  let view: 'open' | 'archived' = 'open'
  let pending = false
  let revision = 0
  let undoId: string | null = null
  const messages = data.messages.workspaceLibrary
  const labels = data.messages.settings.privacy
  // Main asks with Cancel as the default button; `window.confirm` presses OK on Enter, in English. Component tests
  // mount Home without the bridge.
  // eslint-disable-next-line no-restricted-properties -- only without Home's bridge, as in component tests
  const confirm = (message: string): boolean => api.confirm ? api.confirm(message) : window.confirm(message)
  const mission = data.messages.home.mission
  const root = element('home-workspaces')
  const search = element<HTMLInputElement>('workspace-search')
  const grid = element('workspace-grid')
  const error = element('workspace-error')
  const notice = element('workspace-notice')
  const undo = element<HTMLButtonElement>('workspace-undo')
  const cards = new Map<string, { node: HTMLElement; signature: string }>()
  const newTile = document.createElement('div')
  const feed = mountActivityFeed(data)
  const count = (message: string, value: number): string => pluralText(data.locale, message, value)
  const t = (key: string, values?: Record<string, unknown>): string => messageAt(data.messages, key, values as Record<string, string | number>)
  const stepText = (step: AgentStepKind, target: string | undefined, tense: 'now' | 'done'): string => agentStepText(t, step, target, tense)
  /** What a card says: an agent that needs you or is working, the last step an agent finished there, or its last use. */
  function cardStatus(group: { id: string; archived: boolean; lastUsedAt?: string; savedAt?: string }): CardStatus {
    if (group.archived) return { tone: 'quiet', text: interpolate(mission.lastUsed, { time: timeAgo(data.locale, group.savedAt ?? '') }) }
    const activity = live.workspaceActivity?.[group.id]
    const lead = activity && (live.agents?.find(agent => agent.key === activity.agentKeys[0])?.name || data.messages.shell.agents.unnamed)
    if (activity && lead && activity.state === 'needs-you') return { tone: 'needs-you', text: interpolate(mission.needsYou, { name: lead }) }
    if (activity && lead && activity.state === 'working') return { tone: 'working', text: interpolate(mission.step, { name: lead, step: stepText(activity.step, activity.target, 'now') }) }
    const last = live.feed?.find(entry => entry.workspaceId === group.id)
    if (last) {
      const step = stepText(last.step, last.target, 'done')
      return { tone: activity ? 'idle' : 'quiet', text: interpolate(mission.lastStep, { name: last.agentName, step: last.outcome === 'failed' ? interpolate(data.messages.shell.agentCard.stepFailed, { step }) : step, time: timeAgo(data.locale, last.at) }) }
    }
    if (activity && lead) return { tone: 'idle', text: interpolate(data.messages.shell.agents.idle, { name: lead }) }
    return { tone: 'quiet', text: interpolate(mission.lastUsed, { time: timeAgo(data.locale, group.lastUsedAt ?? '') }) }
  }
  /** The newest request of each agent that still needs you in a workspace; older or failed requests are history. */
  function waitingFor(): (entry: HomeFeedEntry) => boolean {
    const seen = new Set<string>()
    const waiting = new Set<string>()
    for (const entry of live.feed ?? []) {
      if (entry.step !== 'askYou' || entry.outcome !== 'done') continue
      const key = `${entry.workspaceId}\n${entry.agentKey}`
      if (seen.has(key)) continue
      seen.add(key)
      const activity = live.workspaceActivity?.[entry.workspaceId]
      if (activity?.state === 'needs-you' && activity.agentKeys[0] === entry.agentKey) waiting.add(entry.id)
    }
    return entry => waiting.has(entry.id)
  }
  function render(): void {
    const groups = [
      ...state.mcpTabGroups.map(group => ({ ...group, archived: false, timestamp: group.lastUsedAt, tabs: state.tabs.filter(tab => tab.mcpGroupId === group.id) })),
      ...state.savedTabGroups.map(group => ({ ...group, archived: true, timestamp: group.savedAt }))
    ].sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.name.localeCompare(b.name))
    const query = search.value.trim().toLocaleLowerCase(data.locale)
    const visible = groups.filter(group => group.archived === (view === 'archived') && `${group.name} ${group.description ?? ''} ${group.tabs.map(tab => `${tabTitleForDisplay(tab, tab.url === 'about:blank' ? data.messages.tabSearch.newTabTitle : '')} ${tab.url}`).join(' ')}`.toLocaleLowerCase(data.locale).includes(query))
    for (const collection of ['open', 'archived'] as const) {
      const tab = element<HTMLButtonElement>(`workspaces-${collection}`)
      tab.textContent = `${messages[collection]} (${groups.filter(group => group.archived === (collection === 'archived')).length})`
      tab.setAttribute('aria-selected', String(view === collection))
      tab.tabIndex = view === collection ? 0 : -1
    }
    grid.setAttribute('aria-labelledby', `workspaces-${view}`)
    element('workspace-hint').textContent = messages[view === 'archived' ? 'archiveHelp' : 'openHelp']
    // Undo stays while the archive does: a cleared workspace's goes once the shell deletes it.
    undo.hidden = !undoId || !state.savedTabGroups.some(group => group.id === undoId)
    for (const [id, card] of cards) if (!visible.some(group => group.id === id)) { card.node.remove(); cards.delete(id) }
    grid.querySelector('.workspace-empty')?.remove()
    visible.forEach((group, index) => {
      const status = cardStatus(group)
      const signature = JSON.stringify([group, state.allHumanInteractionLocked])
      let card = cards.get(group.id)
      if (!card) { card = { node: document.createElement('article'), signature: '' }; cards.set(group.id, card) }
      const focused = card.node.contains(document.activeElement) ? document.activeElement as HTMLElement : null
      const focusKey = focused?.dataset.workspaceAction ?? focused?.dataset.workspacePreference
      let focusTarget = focused
      if (card.signature !== signature) {
        renderWorkspaceCard(card.node, group, { messages, labels, mission, untitledTab: data.messages.tabSearch.newTabTitle, count, allHumanInteractionLocked: state.allHumanInteractionLocked, status })
        card.signature = signature
        focusTarget = focusKey
          ? card.node.querySelector<HTMLElement>(`[data-workspace-action="${focusKey}"],[data-workspace-preference="${focusKey}"]`)
          : focused?.tagName === 'SUMMARY' ? card.node.querySelector('summary') : null
      } else updateCardStatus(card.node, status)
      // Failed or unchanged saves still need to restore the authoritative values.
      if (!pending) for (const preference of ['hiddenFromSidebar', 'deletionProtected'] as const) {
        const input = card.node.querySelector<HTMLInputElement>(`[data-workspace-preference="${preference}"]`)
        if (input) input.checked = Boolean(group[preference])
      }
      // Retain the same card and controls on polling; move only when ordering changes.
      if (grid.children[index] !== card.node) grid.insertBefore(card.node, grid.children[index] ?? null)
      // Moving an existing card can blur its controls; restore only after ordering.
      if (focusTarget?.isConnected && document.activeElement !== focusTarget) focusTarget.focus({ preventScroll: true })
    })
    // Open workspaces end with a tile for a new one; a search or the archive shows only what matches.
    if (view === 'open' && !query && visible.length) {
      if (grid.lastElementChild !== newTile) grid.append(newTile)
    } else newTile.remove()
    if (!visible.length) renderWorkspaceEmpty(grid, messages[query ? 'noMatches' : view === 'archived' ? 'noArchived' : 'empty'], messages[query ? 'searchHelp' : view === 'archived' ? 'archiveHelp' : 'emptyHelp'])
    feed.update(live.feed ?? [], {
      workspaceName: id => state.mcpTabGroups.find(group => group.id === id)?.name,
      waiting: waitingFor(),
      initial: entry => live.agents?.find(agent => agent.key === entry.agentKey)?.initial
    })
    root.setAttribute('aria-busy', String(pending))
    root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button[data-workspace-action],input[data-workspace-preference]').forEach(control => {
      if (pending) {
        // The control the person is on stays enabled: Chromium drops focus from a disabled control, which would close
        // its menu and send focus to the search field. Pressing it again meanwhile does nothing, as `action` ignores it.
        if (control === document.activeElement) return
        control.dataset.wasDisabled ??= String(control.disabled); control.disabled = true
      } else if (control.dataset.wasDisabled !== undefined) { control.disabled = control.dataset.wasDisabled === 'true'; delete control.dataset.wasDisabled }
    })
  }
  async function action(input: HomeWorkspaceAction): Promise<void> {
    if (pending || signal.aborted) return
    const group = 'workspaceId' in input ? [...state.mcpTabGroups, ...state.savedTabGroups].find(candidate => candidate.id === input.workspaceId) : undefined
    let request = input
    // Deleting an archive cannot be undone, so it asks first. Clearing offers Undo here and in the shell instead, unless
    // the archive has no room for that.
    if (input.view === 'clear') {
      const undoable = state.savedTabGroups.length < MAX_ARCHIVED_WORKSPACES
      if (!group || group.deletionProtected || (!undoable && !confirm(interpolate(messages.clearConfirm, { name: group.name })))) return
      request = { ...input, undoable }
    }
    if (input.view === 'delete' && (!group || group.deletionProtected || !confirm(interpolate(messages.deleteConfirm, { name: group.name })))) return
    pending = true
    const generation = ++revision
    error.textContent = ''; error.hidden = true
    render()
    try {
      const next = await api.workspaceAction(request)
      if (generation !== revision || signal.aborted) return
      state = next
      onStateChange?.(state)
      if (request.view === 'archive' || request.view === 'clear' || request.view === 'restore' || request.view === 'delete') {
        // Home's own Undo restores the archive, so it can be reached from the keyboard here too.
        undoId = request.view === 'archive' || (request.view === 'clear' && request.undoable) ? request.workspaceId : null
        notice.textContent = interpolate(messages[request.view === 'archive' ? 'archiveNotice' : request.view === 'restore' ? 'restoreNotice' : request.view === 'clear' ? 'clearNotice' : 'deleteNotice'], { name: group?.name ?? '' })
      }
    } catch (cause) {
      if (generation === revision && !signal.aborted) { error.textContent = errorText(cause, messages.actionError); error.hidden = false }
    } finally {
      if (generation === revision && !signal.aborted) {
        pending = false
        render()
        // A card that went away took focus with it: keep the person in the list, on Undo when it is offered.
        if (!root.contains(document.activeElement) && 'workspaceId' in request) (undo.hidden ? search : undo).focus({ preventScroll: true })
      }
    }
  }
  async function refresh(): Promise<void> {
    if (pending || signal.aborted || !api?.getWorkspaces) return
    const generation = ++revision
    try {
      const next = await api.getWorkspaces()
      if (generation !== revision || signal.aborted) return
      state = next; onStateChange?.(state); render()
    } catch { /* Actions surface errors; polling retains the last usable view. */ }
  }
  root.addEventListener('click', event => {
    const control = (event.target as Element).closest<HTMLButtonElement>('[data-workspace-action]')
    if (!control || control.disabled) return
    // A menu closes once one of its actions is chosen, and gives focus back to its button.
    const menu = control.closest<HTMLDetailsElement>('.card-menu')
    if (menu) { menu.open = false; menu.querySelector('summary')?.focus({ preventScroll: true }) }
    const actionView = control.dataset.workspaceAction
    if (actionView === 'create' || actionView === 'templates') void action({ view: actionView })
    else if (['open', 'edit', 'transfer', 'delete', 'archive', 'clear'].includes(actionView ?? '') && control.dataset.workspaceId) {
      void action({ view: actionView as 'open' | 'edit' | 'transfer' | 'delete' | 'archive' | 'clear', workspaceId: control.dataset.workspaceId })
    }
  }, { signal })
  root.addEventListener('change', event => {
    const input = (event.target as Element).closest<HTMLInputElement>('[data-workspace-preference]')
    if (input?.dataset.workspaceId) void action({ view: 'preferences', workspaceId: input.dataset.workspaceId, [input.dataset.workspacePreference!]: input.checked })
  }, { signal })
  // One card menu at a time; it closes on Escape or a click elsewhere.
  root.addEventListener('toggle', event => {
    const opened = event.target as HTMLDetailsElement
    if (opened.classList?.contains('card-menu') && opened.open) root.querySelectorAll<HTMLDetailsElement>('.card-menu[open]').forEach(menu => { if (menu !== opened) menu.open = false })
  }, { capture: true, signal })
  root.addEventListener('keydown', event => {
    const menu = (event.target as Element).closest<HTMLDetailsElement>('.card-menu[open]')
    if (event.key !== 'Escape' || event.isComposing || !menu) return
    event.preventDefault()
    menu.open = false
    menu.querySelector('summary')?.focus()
  }, { signal })
  // A click outside an open menu only closes it, so it does not open a card, feed step or agent's workspace under it as well.
  document.addEventListener('click', event => {
    const open = [...root.querySelectorAll<HTMLDetailsElement>('.card-menu[open]')].filter(menu => !menu.contains(event.target as Node))
    if (!open.length) return
    open.forEach(menu => { menu.open = false })
    if ((event.target as Element).closest?.('.card-open, .feed-open, .home-agent-workspace')) { event.preventDefault(); event.stopPropagation() }
  }, { capture: true, signal })
  // Tabbing out of a menu closes it; a click is left to the listener above.
  let pointing = false
  document.addEventListener('pointerdown', () => { pointing = true }, { capture: true, signal })
  document.addEventListener('pointerup', () => { setTimeout(() => { pointing = false }) }, { capture: true, signal })
  root.addEventListener('focusout', event => {
    const menu = (event.target as Element).closest<HTMLDetailsElement>('.card-menu[open]')
    if (menu && !pointing && !menu.contains(event.relatedTarget as Node | null)) menu.open = false
  }, { signal })
  search.addEventListener('input', render, { signal })
  undo.addEventListener('click', () => { if (undoId) void action({ view: 'restore', workspaceId: undoId }) }, { signal })
  for (const collection of ['open', 'archived'] as const) {
    const tab = element<HTMLButtonElement>(`workspaces-${collection}`)
    tab.addEventListener('click', () => { view = collection; render() }, { signal })
    tab.addEventListener('keydown', event => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      view = event.key === 'Home' ? 'open' : event.key === 'End' ? 'archived' : view === 'open' ? 'archived' : 'open'
      render(); element(`workspaces-${view}`).focus()
    }, { signal })
  }
  renderNewWorkspaceTile(newTile, data.messages.workspaceSwitcher.newWorkspace, mission.newWorkspaceHelp)
  render()
  /** Agents' state from Home's status, read with the dashboard. */
  function setLive(next: LiveAgents): void {
    live = next
    render()
  }
  return { refresh, setLive }
}

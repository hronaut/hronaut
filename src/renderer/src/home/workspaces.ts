import type { HomeBootstrap, HronautHomeApi } from '../../../shared/home.js'
import type { HomeWorkspaceAction, HomeWorkspaceState } from '../../../shared/home-workspaces.js'
import { element, interpolate } from './dom.js'
import { renderWorkspaceCard, renderWorkspaceEmpty } from './workspace-card.js'

export function mountWorkspaces(data: HomeBootstrap, api: HronautHomeApi, signal: AbortSignal, onStateChange?: (state: HomeWorkspaceState) => void) {
  let state = data.workspaces
  let view: 'open' | 'archived' = 'open'
  let pending = false
  let revision = 0
  let undoId: string | null = null
  const messages = data.messages.workspaceLibrary
  const labels = data.messages.settings.privacy
  const root = element('home-workspaces')
  const search = element<HTMLInputElement>('workspace-search')
  const grid = element('workspace-grid')
  const error = element('workspace-error')
  const notice = element('workspace-notice')
  const undo = element<HTMLButtonElement>('workspace-undo')
  const cards = new Map<string, { node: HTMLElement; signature: string }>()
  const count = (message: string, value: number): string => {
    const forms = message.split(' | ')
    const category = new Intl.PluralRules(data.locale).select(value)
    const index = forms.length === 2 ? (value === 1 ? 0 : 1) : category === 'one' ? 0 : category === 'few' ? 1 : forms.length - 1
    return interpolate(forms[index] || forms[0]!, { count: new Intl.NumberFormat(data.locale).format(value) })
  }
  function render(): void {
    const groups = [
      ...state.mcpTabGroups.map(group => ({ ...group, archived: false, timestamp: group.lastUsedAt, tabs: state.tabs.filter(tab => tab.mcpGroupId === group.id) })),
      ...state.savedTabGroups.map(group => ({ ...group, archived: true, timestamp: group.savedAt }))
    ].sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.name.localeCompare(b.name))
    const query = search.value.trim().toLocaleLowerCase(data.locale)
    const visible = groups.filter(group => group.archived === (view === 'archived') && `${group.name} ${group.description ?? ''} ${group.tabs.map(tab => `${tab.title} ${tab.url}`).join(' ')}`.toLocaleLowerCase(data.locale).includes(query))
    for (const collection of ['open', 'archived'] as const) {
      const tab = element<HTMLButtonElement>(`workspaces-${collection}`)
      tab.textContent = `${messages[collection]} (${groups.filter(group => group.archived === (collection === 'archived')).length})`
      tab.setAttribute('aria-selected', String(view === collection))
      tab.tabIndex = view === collection ? 0 : -1
    }
    grid.setAttribute('aria-labelledby', `workspaces-${view}`)
    element('workspace-hint').textContent = messages[view === 'archived' ? 'archiveHelp' : 'openHelp']
    undo.hidden = !undoId || !state.savedTabGroups.some(group => group.id === undoId)
    for (const [id, card] of cards) if (!visible.some(group => group.id === id)) { card.node.remove(); cards.delete(id) }
    grid.querySelector('.workspace-empty')?.remove()
    visible.forEach((group, index) => {
      const signature = JSON.stringify([group, state.allHumanInteractionLocked])
      let card = cards.get(group.id)
      if (!card) { card = { node: document.createElement('article'), signature: '' }; cards.set(group.id, card) }
      const focused = card.node.contains(document.activeElement) ? document.activeElement as HTMLElement : null
      const focusKey = focused?.dataset.workspaceAction ?? focused?.dataset.workspacePreference
      let focusTarget = focused
      if (card.signature !== signature) {
        renderWorkspaceCard(card.node, group, { messages, labels, count, allHumanInteractionLocked: state.allHumanInteractionLocked })
        card.signature = signature
        focusTarget = focusKey
          ? card.node.querySelector<HTMLElement>(`[data-workspace-action="${focusKey}"],[data-workspace-preference="${focusKey}"]`)
          : focused?.tagName === 'SUMMARY' ? card.node.querySelector('summary') : null
      }
      // Retain the same card and controls on polling; move only when ordering changes.
      if (grid.children[index] !== card.node) grid.insertBefore(card.node, grid.children[index] ?? null)
      // Moving an existing card can blur its controls; restore only after ordering.
      if (focusTarget?.isConnected && document.activeElement !== focusTarget) focusTarget.focus({ preventScroll: true })
    })
    if (!visible.length) renderWorkspaceEmpty(grid, messages[query ? 'noMatches' : view === 'archived' ? 'noArchived' : 'empty'], messages[query ? 'searchHelp' : view === 'archived' ? 'archiveHelp' : 'emptyHelp'])
    root.setAttribute('aria-busy', String(pending))
    root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button[data-workspace-action],input[data-workspace-preference]').forEach(control => {
      if (pending) { control.dataset.wasDisabled ??= String(control.disabled); control.disabled = true }
      else if (control.dataset.wasDisabled !== undefined) { control.disabled = control.dataset.wasDisabled === 'true'; delete control.dataset.wasDisabled }
    })
  }
  async function action(request: HomeWorkspaceAction): Promise<void> {
    if (pending || signal.aborted) return
    const group = 'workspaceId' in request ? [...state.mcpTabGroups, ...state.savedTabGroups].find(group => group.id === request.workspaceId) : undefined
    if (request.view === 'delete' || request.view === 'clear') {
      if (!group || group.deletionProtected || !window.confirm(interpolate(messages[request.view === 'clear' ? 'clearConfirm' : 'deleteConfirm'], { name: group.name }))) return
    }
    pending = true
    const generation = ++revision
    error.textContent = ''; error.hidden = true
    render()
    try {
      const next = await api.workspaceAction(request)
      if (generation !== revision || signal.aborted) return
      state = next
      onStateChange?.(state)
      if (request.view === 'archive') { undoId = request.workspaceId; notice.textContent = interpolate(messages.archiveNotice, { name: group?.name ?? '' }) }
      if (request.view === 'restore' || request.view === 'delete' || request.view === 'clear') {
        undoId = null
        notice.textContent = interpolate(messages[request.view === 'restore' ? 'restoreNotice' : request.view === 'clear' ? 'clearNotice' : 'deleteNotice'], { name: group?.name ?? '' })
      }
    } catch (cause) {
      if (generation === revision && !signal.aborted) { error.textContent = cause instanceof Error ? cause.message : messages.actionError; error.hidden = false }
    } finally { if (generation === revision && !signal.aborted) { pending = false; render() } }
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
  render()
  return { refresh }
}

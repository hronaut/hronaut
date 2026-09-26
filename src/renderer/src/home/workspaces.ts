import type { HomeBootstrap, HronautHomeApi } from '../../../shared/home.js'
import type { HomeWorkspaceAction } from '../../../shared/home-workspaces.js'
import { BROWSER_TAB_GROUP_COLOR_HEX } from '../../../shared/tab-groups.js'
import { element, escapeText as h, interpolate } from './dom.js'

export function mountWorkspaces(data: HomeBootstrap, api: HronautHomeApi, signal: AbortSignal) {
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
  const button = (action: string, label: string, id: string, disabled = false, primary = false): string => `<button type="button" data-workspace-action="${action}" data-workspace-id="${h(id)}"${disabled ? ' disabled' : ''}${primary ? ' class="workspace-primary"' : ''}>${h(label)}</button>`
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
      const signature = JSON.stringify(group)
      let card = cards.get(group.id)
      if (!card) { card = { node: document.createElement('article'), signature: '' }; cards.set(group.id, card) }
      if (card.signature !== signature) {
        const expanded = card.node.querySelector('details')?.open
        const focused = card.node.contains(document.activeElement) ? document.activeElement as HTMLElement : null
        const focusKey = focused?.dataset.workspaceAction ?? focused?.dataset.workspacePreference
        const badges = [messages[group.agentAccess === false ? 'personal' : 'agentAccess'], ...(group.hiddenFromSidebar ? [messages.hidden] : []), ...(group.deletionProtected ? [messages.protected] : []), ...(group.navigationPolicy.mode === 'restricted' ? [messages.restricted] : [])]
        card.node.className = 'home-workspace-card'
        card.node.setAttribute('aria-label', group.name)
        card.node.innerHTML = `<header><span class="workspace-symbol" style="--workspace-color:${BROWSER_TAB_GROUP_COLOR_HEX[group.color]}" aria-hidden="true">${group.archived ? '▤' : '▱'}</span><div><h2>${h(group.name)}</h2><span>${h(count(labels.workspaceTabs, group.tabs.length))} · ${h(count(labels.workspaceSites, group.storageOriginCount || 0))}</span></div></header><div class="home-workspace-badges">${badges.map(label => `<span>${h(label)}</span>`).join('')}</div>${group.description ? `<p class="home-workspace-description">${h(group.description)}</p>` : ''}<p class="home-workspace-preview">${h(group.tabs.slice(0, 2).map(tab => tab.title || tab.url).join(' · ') || messages.noTabs)}</p><footer>${button('open', group.archived ? messages.restore : messages.openWorkspace, group.id, false, true)}${button(group.archived ? 'transfer' : 'edit', group.archived ? labels.transferData : labels.manageWorkspace, group.id)}${button(group.archived ? 'delete' : 'archive', group.archived ? messages.delete : messages.archive, group.id, state.allHumanInteractionLocked || (group.archived && group.deletionProtected))}${group.archived ? '' : button('clear', messages.clear, group.id, group.deletionProtected)}</footer><details class="workspace-quick-settings"${expanded ? ' open' : ''}><summary>${h(messages.preferences)}</summary>${(['hiddenFromSidebar', 'deletionProtected'] as const).map(preference => `<label><input type="checkbox" data-workspace-preference="${preference}" data-workspace-id="${h(group.id)}"${group[preference] ? ' checked' : ''}>${h(messages[preference === 'hiddenFromSidebar' ? 'hideFromSidebar' : 'protectDeletion'])}</label>`).join('')}</details>`
        card.signature = signature
        if (focusKey) card.node.querySelector<HTMLElement>(`[data-workspace-action="${focusKey}"],[data-workspace-preference="${focusKey}"]`)?.focus()
      }
      // Retain the same card and controls on polling; move only when ordering changes.
      if (grid.children[index] !== card.node) grid.insertBefore(card.node, grid.children[index] ?? null)
    })
    if (!visible.length) grid.innerHTML = `<div class="workspace-empty"><h2>${h(messages[query ? 'noMatches' : view === 'archived' ? 'noArchived' : 'empty'])}</h2><p>${h(messages[query ? 'searchHelp' : view === 'archived' ? 'archiveHelp' : 'emptyHelp'])}</p></div>`
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
      state = next; render()
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
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      view = event.key === 'Home' ? 'open' : event.key === 'End' ? 'archived' : view === 'open' ? 'archived' : 'open'
      render(); element(`workspaces-${view}`).focus()
    }, { signal })
  }
  render()
  return { refresh }
}

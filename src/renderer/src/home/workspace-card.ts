import type { HomeBootstrap } from '../../../shared/home.js'
import type { BrowserTabGroupState } from '../../../shared/types.js'
import { BROWSER_TAB_GROUP_COLOR_HEX } from '../../../shared/tab-groups.js'

type WorkspaceCard = Pick<BrowserTabGroupState,
  'id' | 'name' | 'color' | 'description' | 'agentAccess' | 'hiddenFromSidebar' |
  'deletionProtected' | 'navigationPolicy' | 'storageOriginCount'> & {
  archived: boolean
  tabs: Array<{ title: string; url: string }>
}

interface CardContext {
  messages: HomeBootstrap['messages']['workspaceLibrary']
  labels: HomeBootstrap['messages']['settings']['privacy']
  count: (message: string, value: number) => string
  allHumanInteractionLocked: boolean
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.textContent = value
  if (className) node.className = className
  return node
}

// Layout construction is independent of polling, reconciliation and action dispatch.
export function renderWorkspaceCard(card: HTMLElement, group: WorkspaceCard, context: CardContext): void {
  const { messages, labels, count, allHumanInteractionLocked } = context
  const expanded = card.querySelector('details')?.open ?? false
  const button = (action: string, label: string, disabled = false, primary = false): HTMLButtonElement => {
    const control = text('button', label, primary ? 'workspace-primary' : undefined)
    control.type = 'button'
    control.dataset.workspaceAction = action
    control.dataset.workspaceId = group.id
    control.disabled = disabled
    return control
  }
  const header = document.createElement('header')
  const symbol = text('span', group.archived ? '▤' : '▱', 'workspace-symbol')
  symbol.style.setProperty('--workspace-color', BROWSER_TAB_GROUP_COLOR_HEX[group.color])
  symbol.setAttribute('aria-hidden', 'true')
  const title = document.createElement('div')
  title.append(text('h2', group.name), text('span', `${count(labels.workspaceTabs, group.tabs.length)} · ${count(labels.workspaceSites, group.storageOriginCount || 0)}`))
  header.append(symbol, title)

  const badges = document.createElement('div')
  badges.className = 'home-workspace-badges'
  const badgeLabels = [messages[group.agentAccess === false ? 'personal' : 'agentAccess']]
  if (group.hiddenFromSidebar) badgeLabels.push(messages.hidden)
  if (group.deletionProtected) badgeLabels.push(messages.protected)
  if (group.navigationPolicy.mode === 'restricted') badgeLabels.push(messages.restricted)
  badges.append(...badgeLabels.map(label => text('span', label)))

  const preview = text('p', group.tabs.slice(0, 2).map(tab => tab.title || tab.url).join(' · ') || messages.noTabs, 'home-workspace-preview')
  const footer = document.createElement('footer')
  footer.append(
    button('open', group.archived ? messages.restore : messages.openWorkspace, false, true),
    button(group.archived ? 'transfer' : 'edit', group.archived ? labels.transferData : labels.manageWorkspace),
    button(group.archived ? 'delete' : 'archive', group.archived ? messages.delete : messages.archive,
      (allHumanInteractionLocked && (group.archived || group.tabs.length > 0)) || Boolean(group.archived && group.deletionProtected))
  )
  if (!group.archived) footer.append(button('clear', messages.clear, group.deletionProtected))

  const preferences = document.createElement('details')
  preferences.className = 'workspace-quick-settings'
  preferences.open = expanded
  preferences.append(text('summary', messages.preferences))
  for (const preference of ['hiddenFromSidebar', 'deletionProtected'] as const) {
    const label = document.createElement('label')
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.dataset.workspacePreference = preference
    input.dataset.workspaceId = group.id
    input.checked = Boolean(group[preference])
    label.append(input, document.createTextNode(messages[preference === 'hiddenFromSidebar' ? 'hideFromSidebar' : 'protectDeletion']))
    preferences.append(label)
  }

  card.className = 'home-workspace-card'
  card.setAttribute('aria-label', group.name)
  card.replaceChildren(header, badges,
    ...(group.description ? [text('p', group.description, 'home-workspace-description')] : []),
    preview, footer, preferences)
}

export function renderWorkspaceEmpty(grid: HTMLElement, title: string, help: string): void {
  const empty = document.createElement('div')
  empty.className = 'workspace-empty'
  empty.append(text('h2', title), text('p', help))
  grid.replaceChildren(empty)
}

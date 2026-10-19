import type { HomeBootstrap } from '../../../shared/home.js'
import { HOME_CARD_TAB_LIMIT } from '../../../shared/home-workspaces.js'
import type { BrowserTabGroupState } from '../../../shared/types.js'
import { BROWSER_TAB_GROUP_COLOR_HEX } from '../../../shared/tab-groups.js'
import { tabTitleForDisplay } from '../../../shared/tab-title.js'
import { interpolate } from './dom.js'

type WorkspaceCard = Pick<BrowserTabGroupState,
  'id' | 'name' | 'color' | 'description' | 'agentAccess' | 'hiddenFromSidebar' |
  'deletionProtected' | 'navigationPolicy' | 'storageOriginCount'> & {
  archived: boolean
  tabs: Array<{ title: string; url: string; faviconDataUrl?: string }>
}

/** What a card says about its agents or its last use; the tone colors its dot. */
export interface CardStatus {
  tone: 'needs-you' | 'working' | 'idle' | 'quiet'
  text: string
}

interface CardContext {
  messages: HomeBootstrap['messages']['workspaceLibrary']
  labels: HomeBootstrap['messages']['settings']['privacy']
  mission: HomeBootstrap['messages']['home']['mission']
  /** What a blank tab without a title of its own is called. */
  untitledTab: string
  count: (message: string, value: number) => string
  allHumanInteractionLocked: boolean
  status: CardStatus
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.textContent = value
  if (className) node.className = className
  return node
}

/** A page's site as people read it: `shop.example.com`, without `www.`; empty for Hronaut's own pages. */
function siteName(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.hostname.replace(/^www\./u, '') : ''
  } catch { return '' }
}

/** Up to four of the workspace's tabs over its color: each with its site icon, or the site's initial, and its title. */
function renderTabs(group: WorkspaceCard, context: CardContext): HTMLElement {
  const tiles = document.createElement('ul')
  tiles.className = 'card-tabs'
  tiles.style.setProperty('--workspace-color', BROWSER_TAB_GROUP_COLOR_HEX[group.color])
  tiles.setAttribute('aria-label', context.count(context.labels.workspaceTabs, group.tabs.length))
  const hidden = group.tabs.length > HOME_CARD_TAB_LIMIT ? group.tabs.length - HOME_CARD_TAB_LIMIT + 1 : 0
  for (const tab of group.tabs.slice(0, HOME_CARD_TAB_LIMIT - (hidden ? 1 : 0))) {
    const tile = document.createElement('li')
    tile.className = 'card-tab'
    const site = siteName(tab.url)
    const title = tabTitleForDisplay(tab, tab.url === 'about:blank' ? context.untitledTab : '')
    if (tab.faviconDataUrl) {
      const icon = document.createElement('img')
      icon.className = 'card-tab-icon'
      icon.src = tab.faviconDataUrl
      icon.alt = ''
      icon.width = 16
      icon.height = 16
      tile.append(icon)
    } else {
      const initial = text('span', (site || title || '·').charAt(0).toLocaleUpperCase(), 'card-tab-icon card-tab-initial')
      initial.setAttribute('aria-hidden', 'true')
      tile.append(initial)
    }
    tile.append(text('span', title || site || tab.url, 'card-tab-title'))
    tiles.append(tile)
  }
  if (hidden) tiles.append(text('li', `+${hidden}`, 'card-tab card-tab-more'))
  if (!group.tabs.length) tiles.append(text('li', context.messages.noTabs, 'card-tab card-tab-empty'))
  return tiles
}

// Layout construction is independent of polling, reconciliation and action dispatch.
export function renderWorkspaceCard(card: HTMLElement, group: WorkspaceCard, context: CardContext): void {
  const { messages, labels, mission, count, allHumanInteractionLocked, status } = context
  const menuOpen = card.querySelector<HTMLDetailsElement>('.card-menu')?.open ?? false
  const button = (action: string, label: string, disabled = false, className?: string): HTMLButtonElement => {
    const control = text('button', label, className)
    control.type = 'button'
    control.dataset.workspaceAction = action
    control.dataset.workspaceId = group.id
    control.disabled = disabled
    return control
  }
  const archiveLocked = allHumanInteractionLocked && (group.archived || group.tabs.length > 0)
  const moreActions = interpolate(mission.moreActions, { name: group.name })

  const menu = document.createElement('details')
  menu.className = 'card-menu'
  menu.open = menuOpen
  const summary = text('summary', '⋯')
  summary.setAttribute('aria-label', moreActions)
  summary.title = moreActions
  const list = document.createElement('div')
  list.className = 'card-menu-list'
  if (!group.archived) list.append(button('edit', labels.manageWorkspace))
  list.append(button('transfer', labels.transferData))
  for (const preference of ['hiddenFromSidebar', 'deletionProtected'] as const) {
    const label = document.createElement('label')
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.dataset.workspacePreference = preference
    input.dataset.workspaceId = group.id
    input.checked = Boolean(group[preference])
    label.append(input, document.createTextNode(messages[preference === 'hiddenFromSidebar' ? 'hideFromSidebar' : 'protectDeletion']))
    list.append(label)
  }
  list.append(document.createElement('hr'))
  if (group.archived) list.append(button('delete', messages.delete, archiveLocked || group.deletionProtected, 'danger'))
  else list.append(button('archive', messages.archive, archiveLocked), button('clear', messages.clear, group.deletionProtected, 'danger'))
  menu.append(summary, list)

  const header = document.createElement('header')
  const dot = document.createElement('span')
  dot.className = 'workspace-dot'
  dot.style.setProperty('--workspace-color', BROWSER_TAB_GROUP_COLOR_HEX[group.color])
  dot.setAttribute('aria-hidden', 'true')
  header.append(dot, text('h2', group.name), menu)

  const meta = text('p', `${count(labels.workspaceTabs, group.tabs.length)} · ${count(labels.workspaceSites, group.storageOriginCount || 0)}`, 'card-meta')
  const statusLine = document.createElement('p')
  statusLine.className = 'card-status'
  const statusDot = document.createElement('span')
  statusDot.className = 'card-status-dot'
  statusDot.setAttribute('aria-hidden', 'true')
  statusLine.append(statusDot, text('span', ''))

  const badgeLabels: string[] = []
  if (group.agentAccess === false) badgeLabels.push(messages.personal)
  if (group.hiddenFromSidebar) badgeLabels.push(messages.hidden)
  if (group.deletionProtected) badgeLabels.push(messages.protected)
  if (group.navigationPolicy.mode === 'restricted') badgeLabels.push(messages.restricted)
  const badges = document.createElement('div')
  badges.className = 'home-workspace-badges'
  badges.append(...badgeLabels.map(label => text('span', label)))

  // An open workspace opens from anywhere on its card: its open button stretches over the card and keeps its name.
  // An archived one asks for its Restore button, since restoring changes the sidebar.
  const open = button('open', group.archived ? messages.restore : interpolate(mission.open, { name: group.name }), false, group.archived ? 'workspace-primary' : 'card-open')
  if (!group.archived) open.title = group.name
  const footer = document.createElement('footer')
  footer.className = 'card-footer'
  footer.append(open)

  card.className = `home-workspace-card${group.archived ? ' archived' : ''}`
  card.setAttribute('aria-label', group.name)
  card.replaceChildren(renderTabs(group, context), header, meta, statusLine,
    ...(badgeLabels.length ? [badges] : []),
    ...(group.description ? [text('p', group.description, 'home-workspace-description')] : []),
    footer)
  updateCardStatus(card, status)
}

/** Changes only a card's status line and its needs-you ring, so a busy agent's steps never rebuild the card under the
 * person's pointer. */
export function updateCardStatus(card: HTMLElement, status: CardStatus): void {
  const line = card.querySelector<HTMLElement>('.card-status')
  const label = line?.lastElementChild
  if (!line || !label) return
  const className = `card-status ${status.tone}`
  if (line.className !== className) line.className = className
  if (label.textContent !== status.text) label.textContent = status.text
  card.classList.toggle('needs-you', status.tone === 'needs-you')
}

/** The last tile of the open workspaces: a new, empty workspace. */
export function renderNewWorkspaceTile(tile: HTMLElement, title: string, help: string): void {
  const control = document.createElement('button')
  control.type = 'button'
  control.className = 'new-workspace-tile'
  control.dataset.workspaceAction = 'create'
  const plus = text('span', '+', 'new-workspace-plus')
  plus.setAttribute('aria-hidden', 'true')
  control.append(plus, text('strong', title), text('span', help))
  tile.className = 'home-workspace-new'
  tile.replaceChildren(control)
}

export function renderWorkspaceEmpty(grid: HTMLElement, title: string, help: string): void {
  const empty = document.createElement('div')
  empty.className = 'workspace-empty'
  empty.append(text('h2', title), text('p', help))
  grid.replaceChildren(empty)
}

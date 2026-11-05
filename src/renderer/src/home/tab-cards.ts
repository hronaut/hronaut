import type { HomeArchivedWorkspace, HomeClosedTab, HomeTab } from '../../../shared/home-tabs.js'
import { BROWSER_TAB_GROUP_COLOR_HEX } from '../../../shared/tab-groups.js'
import { tabTitleForDisplay } from '../../../shared/tab-title.js'
import type { EmulationSummary } from '../../../shared/emulation-description.js'
import type { BrowserTabOverviewPreview } from '../../../shared/types.js'
import { icon, type HomeIcon } from './icons.js'

/** The words and number formats the Tabs view's cards use, in the interface language. */
export interface TabWords {
  t: (key: string, values?: Record<string, string | number>) => string
  /** A `one | other` message for the count. */
  count: (key: string, value: number) => string
  formatTime: (value: string) => string
  describeEmulation: (emulation: EmulationSummary) => string
}

export type TabResultKind = 'open' | 'closed' | 'saved'

/** The id of a result's main button, which the search field names as its active descendant. */
export const tabResultId = (kind: TabResultKind, id: string): string => `tab-result-${kind}-${id}`

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.textContent = value
  if (className) node.className = className
  return node
}

function button(className: string, action: string, focusKey: string, label?: string): HTMLButtonElement {
  const control = document.createElement('button')
  control.type = 'button'
  control.className = className
  control.dataset.tabAction = action
  control.dataset.focusKey = focusKey
  if (label) control.textContent = label
  return control
}

function iconButton(className: string, action: string, name: HomeIcon, label: string, tooltip: string): HTMLButtonElement {
  const control = button(className, action, action)
  control.setAttribute('aria-label', label)
  control.title = tooltip
  control.append(icon(name))
  return control
}

/** A page's site as people read it, `shop.example.com` without `www.`; empty for pages that are not on the web. */
export function siteName(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.hostname.replace(/^www\./u, '') : ''
  } catch { return '' }
}

/** A page's address without its scheme: `example.com/docs?page=2`; a blank page is called one. */
export function displayUrl(url: string, words: TabWords): string {
  if (url === 'about:blank') return words.t('tabSearch.blankPage')
  try {
    const parsed = new URL(url)
    return parsed.host ? `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}` : url
  } catch { return url }
}

/** What a tab is called: the person's label, or else its page's title. */
export function tabName(tab: { title: string; url: string; label?: string; loading?: boolean }, words: TabWords): string {
  return tab.label || tabTitleForDisplay(tab, words.t('tabSearch.newTabTitle'))
}

/** The site's icon, or its initial over the workspace color when it has none. */
function siteIcon(tab: HomeTab, className: string): HTMLElement {
  const holder = document.createElement('span')
  holder.className = className
  holder.setAttribute('aria-hidden', 'true')
  if (tab.loading) holder.append(text('span', '', 'spinner'))
  else if (tab.faviconDataUrl) {
    const image = document.createElement('img')
    image.src = tab.faviconDataUrl
    image.alt = ''
    image.draggable = false
    holder.append(image)
  } else holder.append(text('span', (siteName(tab.url) || tab.title || '·').charAt(0).toLocaleUpperCase(), 'site-initial'))
  return holder
}

type Condition = { text: string; tone?: 'agent' | 'warning' }

/** A state every tab of a workspace shares, said once beside the workspace's name instead of on each card. */
export type SharedCondition = 'locked' | 'muted'

/** What all of a workspace's tabs share; a single tab keeps its states on its own card. */
export function sharedConditions(tabs: readonly HomeTab[]): SharedCondition[] {
  return tabs.length < 2 ? [] : (['locked', 'muted'] as const).filter(condition => tabs.every(tab => tab[condition]))
}

/** The chips for what a workspace's tabs share, in the order a card names them. */
export function renderSharedConditions(shared: readonly SharedCondition[], words: TabWords): HTMLElement[] {
  return shared.map(condition => condition === 'locked'
    ? text('span', words.t('tabSearch.meta.locked'), 'condition warning')
    : text('span', words.t('tabSearch.meta.muted'), 'condition'))
}

/** The conditions a tab card names, such as Pinned or Agent active; its workspace is the section it is listed in, and
 * what all of that workspace's tabs share is said there. */
function tabConditions(tab: HomeTab, words: TabWords, shared: readonly SharedCondition[]): Condition[] {
  const conditions: Condition[] = []
  if (tab.agentActive) conditions.push({ text: words.t('tabSearch.meta.agent'), tone: 'agent' })
  if (tab.pinned) conditions.push({ text: words.t('tabSearch.meta.pinned') })
  if (tab.locked && !shared.includes('locked')) conditions.push({ text: words.t('tabSearch.meta.locked'), tone: 'warning' })
  if (tab.muted) { if (!shared.includes('muted')) conditions.push({ text: words.t('tabSearch.meta.muted') }) }
  else if (tab.audible) conditions.push({ text: words.t('tabSearch.meta.audio') })
  if (tab.emulation) conditions.push({ text: words.t('tabSearch.meta.emulated', { state: words.describeEmulation(tab.emulation) }), tone: 'warning' })
  if (tab.networkRouteCount) conditions.push({ text: words.count('tabSearch.meta.routes', tab.networkRouteCount), tone: 'warning' })
  return conditions
}

export interface OpenTabCard {
  tab: HomeTab
  /** The page shown before Home. */
  current: boolean
  preview?: BrowserTabOverviewPreview
  /** What all of its workspace's tabs share, which its workspace's heading says instead. */
  shared: readonly SharedCondition[]
  /** Whether its ⋯ menu was open, so a refresh keeps it open. */
  menuOpen: boolean
}

/** Changes exactly when the card's drawing would; a refresh redraws only the cards whose signature changed. */
export function openTabSignature({ tab, current, preview, shared }: OpenTabCard): string {
  const picture = preview && [preview.navigationGeneration, preview.sleeping, preview.width, preview.height, preview.dataUrl.length, preview.dataUrl.slice(-24)]
  return JSON.stringify([tab, current, picture, shared])
}

/** An open tab: its picture, name, site and conditions, opened by a click, with its ⋯ menu and close button. */
export function renderOpenTabCard(card: HTMLElement, model: OpenTabCard, words: TabWords): void {
  const { tab, current, preview, shared } = model
  const name = tabName(tab, words)
  card.classList.toggle('current', current)
  card.classList.toggle('sleeping', tab.sleeping)
  const open = button('tab-card-open', 'open', 'open')
  open.id = tabResultId('open', tab.id)
  open.title = tab.url
  const picture = document.createElement('span')
  picture.className = 'tab-card-preview'
  if (preview) {
    const image = document.createElement('img')
    image.src = preview.dataUrl
    image.width = preview.width
    image.height = preview.height
    image.alt = ''
    image.draggable = false
    picture.append(image)
    if (tab.sleeping) {
      const sleeping = text('span', words.t('tabSearch.sleeping'), 'tab-card-badge')
      sleeping.prepend(icon('sleeping'))
      picture.append(sleeping)
    }
  } else {
    // Without a picture the card shows the site's own icon, asleep or not, so tabs of different sites stay apart; a
    // sleeping one says so under it.
    const placeholder = document.createElement('span')
    placeholder.className = 'tab-card-placeholder'
    const site = siteName(tab.url)
    placeholder.append(siteIcon(tab, 'tab-card-placeholder-icon'))
    if (site) placeholder.append(text('strong', site))
    placeholder.append(text('small', words.t(tab.sleeping ? 'tabSearch.previewSleeping' : 'tabSearch.previewNotYet')))
    picture.append(placeholder)
  }
  if (current) picture.append(text('span', words.t('tabSearch.meta.current'), 'tab-card-current'))
  const copy = document.createElement('span')
  copy.className = 'tab-card-copy'
  const title = document.createElement('span')
  title.className = 'tab-card-title'
  title.append(siteIcon(tab, 'site-icon'), text('strong', name))
  copy.append(title)
  if (tab.label) copy.append(text('small', tabTitleForDisplay(tab, words.t('tabSearch.newTabTitle')), 'tab-card-page-title'))
  copy.append(text('span', displayUrl(tab.url, words), 'tab-card-url'))
  const conditions = tabConditions(tab, words, shared)
  if (conditions.length) {
    const list = document.createElement('span')
    list.className = 'tab-card-conditions'
    for (const condition of conditions) list.append(text('span', condition.text, condition.tone ? `condition ${condition.tone}` : 'condition'))
    copy.append(list)
  }
  open.append(picture, copy)

  const actions = document.createElement('div')
  actions.className = 'tab-card-actions'
  const menu = document.createElement('details')
  menu.className = 'card-menu'
  menu.open = model.menuOpen
  const summary = text('summary', '⋯')
  summary.dataset.focusKey = 'menu'
  summary.setAttribute('aria-label', words.t('tabSearch.moreActionsAria', { title: name }))
  summary.title = words.t('tabSearch.moreActions')
  const list = document.createElement('div')
  list.className = 'card-menu-list'
  const fullPage = button('', 'preview', 'preview', words.t('tabSearch.fullPagePreview'))
  fullPage.disabled = tab.sleeping || tab.loading
  const pin = button('', 'pin', 'pin', words.t(tab.pinned ? 'tabSearch.unpin' : 'tabSearch.pin'))
  list.append(pin, fullPage, button('', 'label', 'label', words.t('tabLabel.edit')))
  menu.append(summary, list)
  actions.append(menu, iconButton('tab-card-close', 'close', 'close', words.t('tabSearch.closeTabAria', { title: name }), words.t('tabSearch.closeTab')))

  const label = card.querySelector<HTMLElement>(':scope > .tab-card-label') ?? Object.assign(document.createElement('div'), { className: 'tab-card-label' })
  card.replaceChildren(open, actions, label)
}

/** How long ago a tab was closed: just now, minutes ago, or the time. */
export function closedTabMeta(tab: HomeClosedTab, words: TabWords, now: number): string {
  const elapsed = Math.max(0, now - Date.parse(tab.closedAt))
  const closed = elapsed < 60_000
    ? words.t('tabSearch.meta.justNow')
    : elapsed < 60 * 60_000
      ? words.t('tabSearch.meta.minutesAgo', { count: Math.max(1, Math.floor(elapsed / 60_000)) })
      : words.t('tabSearch.meta.closedAt', { time: words.formatTime(tab.closedAt) })
  return tab.pinned ? `${words.t('tabSearch.meta.pinned')} · ${closed}` : closed
}

/** A recently closed tab, opened again in its place by a click or its restore button. */
export function renderClosedTabRow(row: HTMLElement, tab: HomeClosedTab, words: TabWords, now: number): void {
  const name = tabName(tab, words)
  const open = button('tab-row-open', 'reopen', 'open')
  open.id = tabResultId('closed', tab.id)
  open.title = tab.url
  const symbol = text('span', '', 'tab-row-icon')
  symbol.append(icon('history'))
  const copy = document.createElement('span')
  copy.className = 'tab-row-copy'
  copy.append(text('strong', name))
  if (tab.label) copy.append(text('small', tabTitleForDisplay(tab, words.t('tabSearch.newTabTitle'))))
  copy.append(text('span', displayUrl(tab.url, words)), text('small', closedTabMeta(tab, words, now)))
  open.append(symbol, copy)
  row.replaceChildren(open, iconButton('tab-row-action', 'reopen', 'restore', words.t('tabSearch.restoreAria', { title: name }), words.t('tabSearch.restore')))
}

/** An archived workspace with a few of its tabs, restored by a click, or deleted after a question. */
export function renderArchivedRow(row: HTMLElement, group: HomeArchivedWorkspace, words: TabWords, locked: boolean): void {
  const open = button('tab-row-open', 'restore', 'open')
  open.id = tabResultId('saved', group.id)
  open.title = group.tabs.map(tab => tab.url).join('\n')
  const symbol = text('span', '', 'tab-row-icon workspace')
  symbol.style.setProperty('--workspace-color', BROWSER_TAB_GROUP_COLOR_HEX[group.color])
  symbol.append(icon('folder'))
  const copy = document.createElement('span')
  copy.className = 'tab-row-copy'
  copy.append(
    text('strong', group.name),
    text('span', words.count('tabSearch.savedTabs', group.tabs.length)),
    text('small', group.tabs.slice(0, 3).map(tab => tabName(tab, words)).join(' · '))
  )
  open.append(symbol, copy)
  const remove = iconButton('tab-row-action danger', 'delete', 'delete', words.t('tabSearch.deleteWorkspaceAria', { name: group.name }),
    words.t('tabSearch.deleteWorkspace'))
  remove.disabled = group.deletionProtected || locked
  const restore = iconButton('tab-row-action', 'restore', 'restore', words.t('tabSearch.restoreWorkspaceAria', { name: group.name }),
    words.t('tabSearch.restoreWorkspace'))
  row.replaceChildren(open, restore, remove)
}

import type { HomeBootstrap, HronautHomeApi } from '../../../shared/home.js'
import type { HomeArchivedWorkspace, HomeClosedTab, HomeTab, HomeTabAction, HomeTabsState } from '../../../shared/home-tabs.js'
import type { BrowserTabGroupColor, BrowserTabOverviewPreview } from '../../../shared/types.js'
import { commandShortcutKeys } from '../../../shared/command-palette.js'
import { splitConfirmation, type Confirmation } from '../../../shared/confirmation.js'
import { describeEmulation } from '../../../shared/emulation-description.js'
import { formatNumber, formatPercent, formatTime } from '../../../shared/format.js'
import { pluralFormIndex } from '../../../shared/plural.js'
import { BROWSER_TAB_GROUP_COLOR_HEX } from '../../../shared/tab-groups.js'
import { normalizeTabLabel } from '../../../shared/tab-label.js'
import { tabTitleForDisplay } from '../../../shared/tab-title.js'
import { element, errorText, interpolate, messageAt } from './dom.js'
import { icon } from './icons.js'
import {
  closedTabMeta, openTabSignature, renderArchivedRow, renderClosedTabRow, renderOpenTabCard, tabName, tabResultId, type TabResultKind, type TabWords
} from './tab-cards.js'
import { labelEditorSignature, renderLabelEditor, type LabelEdit } from './tab-label-editor.js'
import { mountTabPagePreview } from './tab-page-preview.js'

type Kind = 'all' | 'open' | 'closed' | 'saved'
const KINDS: readonly Kind[] = ['all', 'open', 'closed', 'saved']
type Result =
  | { kind: 'open'; item: HomeTab }
  | { kind: 'closed'; item: HomeClosedTab }
  | { kind: 'saved'; item: HomeArchivedWorkspace }
interface Group { key: string; name: string; color: BrowserTabGroupColor; tabs: HomeTab[] }
interface Drawn { node: HTMLElement; signature: string; labelSignature?: string }

const keyOf = (kind: TabResultKind, id: string): string => `${kind}:${id}`
const VALID_FRAME = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/u

/** A kept frame still shows the tab: its page has not changed, and it is the frame from before sleep exactly while it sleeps. */
/** Whether the frame is the one main holds for the tab now: of its page, asleep or not as the tab is, and as new. */
function frameMatches(frame: BrowserTabOverviewPreview, tab: HomeTab): boolean {
  return frame.navigationGeneration === tab.navigationGeneration && tab.sleeping === (frame.sleeping === true)
    && tab.previewRevision !== undefined && frame.revision === tab.previewRevision
}

/** Puts `children` into `container` in order, moving only the nodes out of place, and drops the rest. */
function placeInOrder(container: HTMLElement, children: HTMLElement[]): void {
  children.forEach((child, index) => {
    if (container.children[index] !== child) container.insertBefore(child, container.children[index] ?? null)
  })
  while (container.children.length > children.length) container.lastElementChild!.remove()
}

/** Draws `node` anew; a control focused in it, named by its focus key, has the focus again afterwards. */
function keepFocus(node: HTMLElement, draw: () => void): void {
  const active = document.activeElement
  const key = active instanceof HTMLElement && node.contains(active) ? active.dataset.focusKey : undefined
  draw()
  if (key) node.querySelector<HTMLElement>(`[data-focus-key="${key}"]`)?.focus({ preventScroll: true })
}

/**
 * Home's Tabs view: the open tabs by workspace with their pictures, the archived workspaces and the recently closed
 * tabs, searched by title, label, address and workspace. Main does every action, as the tab strip and Settings do,
 * and answers with the tabs after it; a read that began before an action is dropped for that answer.
 */
export function mountTabs(data: HomeBootstrap, api: HronautHomeApi, signal: AbortSignal, onChange: () => void) {
  const { locale } = data
  const translate = (key: string, parameters: Record<string, unknown> = {}, plural?: number): string => {
    const message = messageAt(data.messages, key)
    const forms = message.split(' | ')
    const chosen = plural === undefined ? message : forms[pluralFormIndex(locale, plural, forms.length)] ?? forms[0]!
    return interpolate(chosen, parameters as Record<string, string | number>)
  }
  const number = (value: number): string => formatNumber(locale, value)
  const words: TabWords = {
    t: (key, values) => translate(key, values),
    count: (key, value) => translate(key, { count: number(value) }, value),
    formatTime: value => formatTime(locale, value),
    describeEmulation: emulation => describeEmulation(emulation, {
      translate, formatNumber: number, formatPercent: value => formatPercent(locale, value / 100)
    })
  }
  const t = words.t
  const confirm = async (question: Confirmation): Promise<boolean> => {
    if (api.confirm) return api.confirm(question)
    // eslint-disable-next-line no-restricted-properties -- only without Home's bridge, as in component tests
    return window.confirm(question.detail ? `${question.message}\n\n${question.detail}` : question.message)
  }

  const root = element('home-tabs')
  const browse = element('tabs-browse')
  const search = element<HTMLInputElement>('tab-search')
  const results = element('tab-results')
  const status = element('tab-search-status')
  const error = element('tabs-error')
  const backHint = element('tabs-hint-back')
  const backHintText = element('tabs-hint-back-text')
  const mac = data.platform === 'darwin'
  // Control+Shift+A on macOS stays with the page, so the key named there is Command.
  element('tab-search-keys').textContent = commandShortcutKeys('Ctrl/Cmd+Shift+A', mac).join(mac ? ' ' : '+')

  let state: HomeTabsState | null = null
  let query = ''
  let kind: Kind = 'all'
  let selectedKey: string | null = null
  let selectedIndex = 0
  let preferCurrent = false
  let visible = false
  let pending = false
  let revision = 0
  let reading: Promise<void> | null = null
  let readAgain = false
  let readingFrames = false
  let readFramesAgain = false
  let order: Result[] = []
  const frames = new Map<string, BrowserTabOverviewPreview>()
  const edits = new Map<string, LabelEdit>()
  const drawn = new Map<string, Drawn>()
  const sections = new Map<string, HTMLElement>()
  const empty = document.createElement('div')
  empty.className = 'tabs-empty'

  const preview = mountTabPagePreview(element('tab-page-preview'), words, {
    capture: tabId => api.getTabPagePreview!(tabId),
    open: tabId => void act({ kind: 'open', tabId }, 'open'),
    back: backToTabs
  }, signal)
  let previewReturnKey: string | null = null

  const failures = {
    open: ['runtime.workspace.openFailed', 'runtime.workspace.openDescription'],
    restore: ['runtime.workspace.restoreFailed', 'runtime.workspace.restoreDescription'],
    delete: ['runtime.workspace.deleteFailed', 'runtime.workspace.deleteDescription'],
    action: ['runtimeDetails.browserAction', 'runtime.toast.actionFailed']
  } as const
  function showError(failure: keyof typeof failures, cause: unknown): void {
    const [title, description] = failures[failure]
    const heading = document.createElement('strong')
    heading.textContent = t(title)
    error.replaceChildren(heading, document.createTextNode(` ${errorText(cause, t(description))}`))
    error.hidden = false
  }

  /** Runs one action at a time in main and shows the tabs it answers with. Null when it did not run or failed. */
  async function act(action: HomeTabAction, failure?: keyof typeof failures): Promise<HomeTabsState | null> {
    if (pending || !api.tabAction || signal.aborted) return null
    pending = true
    ++revision
    root.setAttribute('aria-busy', 'true')
    error.hidden = true
    try {
      const next = await api.tabAction(action)
      if (signal.aborted) return null
      apply(next)
      return next
    } catch (cause) {
      if (!signal.aborted && failure) showError(failure, cause)
      return null
    } finally {
      pending = false
      root.removeAttribute('aria-busy')
    }
  }

  /**
   * Reads the tabs, one read at a time: a read asked for meanwhile runs once that one ends, so under constant tab
   * changes a slow read is never dropped for a newer one that is dropped in turn.
   */
  function read(): Promise<void> {
    if (reading) { readAgain = true; return reading }
    const current = readOnce().finally(() => {
      reading = null
      if (readAgain && visible && !signal.aborted) { readAgain = false; void read() }
    })
    reading = current
    return current
  }

  async function readOnce(): Promise<void> {
    if (!api.getTabs || signal.aborted) return
    const startedAt = revision
    try {
      const next = await api.getTabs()
      // An action that ran meanwhile answered with newer tabs.
      if (signal.aborted || startedAt !== revision) return
      apply(next)
    } catch { /* The view keeps the tabs it last read; the next read tries again. */ }
  }

  function apply(next: HomeTabsState): void {
    state = next
    const open = new Set(next.tabs.map(tab => tab.id))
    for (const tabId of edits.keys()) if (!open.has(tabId)) edits.delete(tabId)
    for (const [tabId, frame] of frames) {
      const tab = next.tabs.find(candidate => candidate.id === tabId)
      if (!tab || !frameMatches(frame, tab)) frames.delete(tabId)
    }
    render()
    preview.update(next.tabs)
    void readFrames()
  }

  /**
   * Main keeps a frame of each tab from when it was last in view; Home asks only for the ones it does not have yet, or
   * has an older one of.
   */
  async function readFrames(): Promise<void> {
    if (!state || !api.getTabPreviews || signal.aborted) return
    if (readingFrames) { readFramesAgain = true; return }
    const wanted = state.tabs.filter(tab => tab.previewRevision !== undefined && !frames.has(tab.id)).map(tab => tab.id)
    if (!wanted.length) return
    readingFrames = true
    try {
      const answer = await api.getTabPreviews(wanted)
      if (signal.aborted || !state) return
      let changed = false
      for (const frame of answer) {
        const tab = state.tabs.find(candidate => candidate.id === frame.tabId)
        if (!tab || !wanted.includes(frame.tabId) || !frameMatches(frame, tab) || !VALID_FRAME.test(frame.dataUrl)) continue
        if (!Number.isInteger(frame.width) || frame.width < 1 || !Number.isInteger(frame.height) || frame.height < 1) continue
        frames.set(frame.tabId, frame)
        changed = true
      }
      if (changed) render()
    } catch { /* Pictures are optional: the cards keep their placeholders. */ } finally {
      readingFrames = false
      // Tabs read meanwhile may want frames this answer did not cover.
      if (readFramesAgain && !signal.aborted) { readFramesAgain = false; void readFrames() }
    }
  }

  const terms = (): string[] => query.toLocaleLowerCase(locale).trim().split(/\s+/u).filter(Boolean)
  const matches = (wanted: string[], ...fields: string[]): boolean => {
    const text = fields.join('\n').toLocaleLowerCase(locale)
    return wanted.every(term => text.includes(term))
  }
  const pageTitle = (tab: { title: string; url: string; loading?: boolean }): string => tabTitleForDisplay(tab, t('tabSearch.newTabTitle'))

  /** What the search and the result type leave, in the order Up and Down go through it. */
  function filtered(): { groups: Group[]; saved: HomeArchivedWorkspace[]; closed: HomeClosedTab[]; order: Result[] } {
    if (!state) return { groups: [], saved: [], closed: [], order: [] }
    const wanted = terms()
    const names = new Map(state.workspaces.map(workspace => [workspace.id, workspace.name]))
    const open = kind === 'all' || kind === 'open'
      ? state.tabs.filter(tab => matches(wanted, tab.label ?? '', pageTitle(tab), tab.url, names.get(tab.workspaceId ?? '') ?? ''))
      : []
    const groups = state.workspaces.flatMap((workspace): Group[] => {
      const tabs = open.filter(tab => tab.workspaceId === workspace.id)
      return tabs.length ? [{ key: `workspace:${workspace.id}`, name: workspace.name, color: workspace.color, tabs }] : []
    })
    const other = open.filter(tab => !tab.workspaceId || !names.has(tab.workspaceId))
    if (other.length) groups.push({ key: 'workspace:', name: t('tabSearch.ungrouped'), color: 'gray', tabs: other })
    const saved = kind === 'all' || kind === 'saved'
      ? state.archivedWorkspaces.filter(group => matches(wanted, group.name)
        || group.tabs.some(tab => matches(wanted, group.name, tab.label ?? '', pageTitle(tab), tab.url)))
      : []
    const closed = kind === 'all' || kind === 'closed'
      ? state.closedTabs.filter(tab => matches(wanted, tab.label ?? '', pageTitle(tab), tab.url))
      : []
    return {
      groups, saved, closed,
      order: [
        ...groups.flatMap(group => group.tabs.map((item): Result => ({ kind: 'open', item }))),
        ...saved.map((item): Result => ({ kind: 'saved', item })),
        ...closed.map((item): Result => ({ kind: 'closed', item }))
      ]
    }
  }

  let sectionCount = 0
  function section(key: string, heading: string, count: number, list: 'grid' | 'rows', color?: BrowserTabGroupColor): HTMLElement {
    let node = sections.get(key)
    if (!node) {
      const id = `tab-section-${++sectionCount}`
      node = document.createElement('section')
      node.className = 'tab-section'
      const title = document.createElement('h3')
      title.id = id
      const items = document.createElement('div')
      items.className = list === 'grid' ? 'tab-grid' : 'tab-rows'
      items.setAttribute('role', 'list')
      items.setAttribute('aria-labelledby', id)
      node.setAttribute('aria-labelledby', id)
      node.append(title, items)
      sections.set(key, node)
    }
    const title = node.querySelector('h3')!
    const parts: Node[] = []
    if (color) {
      const dot = document.createElement('span')
      dot.className = 'workspace-dot'
      dot.style.setProperty('--workspace-color', BROWSER_TAB_GROUP_COLOR_HEX[color])
      dot.setAttribute('aria-hidden', 'true')
      parts.push(dot)
    }
    const amount = document.createElement('span')
    amount.className = 'count'
    amount.textContent = number(count)
    parts.push(document.createTextNode(heading), amount)
    title.replaceChildren(...parts)
    return node
  }

  function item(key: string, className: string, signature: string, draw: (node: HTMLElement) => void): HTMLElement {
    let entry = drawn.get(key)
    if (!entry) {
      const node = document.createElement('article')
      node.className = className
      node.setAttribute('role', 'listitem')
      node.dataset.resultKey = key
      entry = { node, signature: '' }
      drawn.set(key, entry)
    }
    if (entry.signature !== signature) {
      const { node } = entry
      keepFocus(node, () => draw(node))
      entry.signature = signature
    }
    return entry.node
  }

  function render(): void {
    const view = filtered()
    order = view.order
    const keys = order.map(result => keyOf(result.kind, result.item.id))
    if (preferCurrent && state) {
      // Shown by Search tabs: the page shown before Home is selected, as the tab you are on.
      preferCurrent = false
      const current = state.previousTabId ? keyOf('open', state.previousTabId) : null
      if (current && keys.includes(current)) selectedKey = current
    }
    if (!selectedKey || !keys.includes(selectedKey)) selectedKey = keys[Math.min(selectedIndex, keys.length - 1)] ?? null
    selectedIndex = selectedKey ? keys.indexOf(selectedKey) : 0
    const now = Date.now()
    const locked = state?.locked === true
    const children: HTMLElement[] = []
    for (const group of view.groups) {
      const node = section(group.key, group.name, group.tabs.length, 'grid', group.color)
      node.style.setProperty('--workspace-color', BROWSER_TAB_GROUP_COLOR_HEX[group.color])
      const cards = group.tabs.map(tab => {
        const key = keyOf('open', tab.id)
        const model = { tab, current: tab.id === state?.previousTabId, preview: frames.get(tab.id), menuOpen: false }
        const card = item(key, 'tab-card', openTabSignature(model), node => {
          model.menuOpen = node.querySelector<HTMLDetailsElement>('.card-menu')?.open ?? false
          renderOpenTabCard(node, model, words)
        })
        const entry = drawn.get(key)!
        const edit = edits.get(tab.id)
        const labelSignature = labelEditorSignature(tab, edit)
        if (entry.labelSignature !== labelSignature) {
          const host = card.querySelector<HTMLElement>(':scope > .tab-card-label')!
          keepFocus(host, () => renderLabelEditor(host, tab, edit, words))
          entry.labelSignature = labelSignature
        }
        return card
      })
      placeInOrder(node.querySelector('[role="list"]')!, cards)
      children.push(node)
    }
    if (view.saved.length) {
      const node = section('saved', t('tabSearch.archived'), view.saved.length, 'rows')
      placeInOrder(node.querySelector('[role="list"]')!, view.saved.map(group => item(
        keyOf('saved', group.id), 'tab-row saved', JSON.stringify([group, locked]), node => renderArchivedRow(node, group, words, locked))))
      children.push(node)
    }
    if (view.closed.length) {
      const node = section('closed', t('tabSearch.recentlyClosed'), view.closed.length, 'rows')
      placeInOrder(node.querySelector('[role="list"]')!, view.closed.map(tab => item(
        keyOf('closed', tab.id), 'tab-row closed', JSON.stringify([tab, closedTabMeta(tab, words, now)]), node => renderClosedTabRow(node, tab, words, now))))
      children.push(node)
    }
    const present = new Set(keys)
    for (const key of drawn.keys()) if (!present.has(key)) drawn.delete(key)
    for (const [key, node] of sections) if (!children.includes(node)) sections.delete(key)
    if (!children.length && state) {
      const nothing = !state.tabs.length && !state.closedTabs.length && !state.archivedWorkspaces.length
      const heading = document.createElement('strong')
      heading.textContent = t(nothing ? 'tabSearch.empty' : 'tabSearch.noMatches')
      const parts: Node[] = [icon(nothing ? 'tab' : 'search'), heading]
      if (!nothing) parts.push(Object.assign(document.createElement('span'), { textContent: t('tabSearch.tryAnother') }))
      empty.replaceChildren(...parts)
      children.push(empty)
    }
    placeInOrder(results, children)
    const previous = state?.previousTabId ? state.tabs.find(tab => tab.id === state!.previousTabId) : undefined
    backHint.hidden = !previous
    if (previous) backHintText.textContent = t('tabSearch.backTo', { title: tabName(previous, words) })
    renderSelection()
    onChange()
  }

  function selected(): Result | undefined {
    return order.find(result => keyOf(result.kind, result.item.id) === selectedKey)
  }

  function renderSelection(): void {
    for (const [key, { node }] of drawn) node.classList.toggle('selected', key === selectedKey)
    const result = selected()
    if (result) search.setAttribute('aria-activedescendant', tabResultId(result.kind, result.item.id))
    else search.removeAttribute('aria-activedescendant')
    const label = result ? result.kind === 'saved' ? result.item.name : tabName(result.item, words) : ''
    const next = `${words.count('tabSearch.matches', order.length)}${label ? ` ${t('tabSearch.selected', { item: label })}` : ''}`
    if (status.textContent !== next) status.textContent = next
  }

  function reveal(): void {
    const result = selected()
    if (result) document.getElementById(tabResultId(result.kind, result.item.id))?.scrollIntoView?.({ block: 'nearest' })
  }

  function move(offset: 1 | -1): void {
    if (!order.length) return
    selectedIndex = (selectedIndex + offset + order.length) % order.length
    const result = order[selectedIndex]!
    selectedKey = keyOf(result.kind, result.item.id)
    renderSelection()
    reveal()
  }

  function run(result: Result): void {
    if (result.kind === 'open') void act({ kind: 'open', tabId: result.item.id }, 'open')
    else if (result.kind === 'closed') void act({ kind: 'reopen', closedTabId: result.item.id }, 'open')
    else void act({ kind: 'restore', workspaceId: result.item.id }, 'restore')
  }

  /** The person left the focus on a control that is gone now, or on nothing: the search field takes it. */
  function focusSearchIfLost(hadFocus: boolean): void {
    if (hadFocus && visible && !preview.isOpen() && (document.activeElement === document.body || !document.activeElement)) search.focus({ preventScroll: true })
  }

  async function closeTab(tabId: string, control: HTMLElement): Promise<void> {
    const hadFocus = document.activeElement === control || document.activeElement === document.body
    if (await act({ kind: 'close', tabId }, 'action')) focusSearchIfLost(hadFocus)
  }

  async function deleteArchived(workspaceId: string, control: HTMLElement): Promise<void> {
    const group = state?.archivedWorkspaces.find(candidate => candidate.id === workspaceId)
    if (!group || pending) return
    const question = splitConfirmation(
      parameters => translate('runtimeActions.workspace.deleteConfirm', parameters, group.tabs.length),
      { name: group.name, count: number(group.tabs.length) }
    )
    if (!await confirm(question) || signal.aborted) return
    // An agent may restore, protect or delete it while the question waits; main then refuses.
    const hadFocus = document.activeElement === control || document.activeElement === document.body
    if (await act({ kind: 'delete', workspaceId }, 'delete')) focusSearchIfLost(hadFocus)
  }

  function startEdit(tabId: string): void {
    const tab = state?.tabs.find(candidate => candidate.id === tabId)
    if (!tab) return
    edits.set(tabId, { draft: tab.label ?? '', error: '', pending: false })
    render()
    const input = drawn.get(keyOf('open', tabId))?.node.querySelector<HTMLInputElement>('.tab-label-form input')
    input?.focus({ preventScroll: true })
    input?.closest('form')?.scrollIntoView?.({ block: 'nearest' })
  }

  function stopEdit(tabId: string, restoreFocus: boolean): void {
    edits.delete(tabId)
    render()
    if (restoreFocus) drawn.get(keyOf('open', tabId))?.node.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true })
  }

  async function saveLabel(tabId: string, clear: boolean): Promise<void> {
    const edit = edits.get(tabId)
    if (!edit || edit.pending || pending) return
    const label = clear ? '' : edit.draft
    try { normalizeTabLabel(label) } catch {
      edit.error = t('tabLabel.invalid')
      render()
      return
    }
    const host = drawn.get(keyOf('open', tabId))?.node
    const ownsFocus = (): boolean => document.activeElement === document.body || Boolean(host?.contains(document.activeElement))
    edit.pending = true
    edit.error = ''
    render()
    const next = await act({ kind: 'label', tabId, label })
    // Cancelled, or the view was shown anew, while main saved it.
    if (edits.get(tabId) !== edit) return
    edit.pending = false
    const saved = next?.tabs.find(candidate => candidate.id === tabId)
    if (next && !saved) { edits.delete(tabId); render(); return }
    if (!next) edit.error = t('tabLabel.failed')
    else if (saved?.labelDurabilityUnconfirmed) edit.error = t('tabLabel.uncertain')
    else { stopEdit(tabId, ownsFocus()); return }
    render()
  }

  function showPreview(tab: HomeTab, returnKey: string | null): void {
    if (pending || tab.sleeping || tab.loading || !api.getTabPagePreview) return
    previewReturnKey = returnKey
    browse.hidden = true
    preview.show(tab)
  }

  function backToTabs(): void {
    preview.hide()
    browse.hidden = false
    const target = previewReturnKey ? drawn.get(previewReturnKey)?.node.querySelector<HTMLElement>('summary') : null
    ;(target ?? search).focus({ preventScroll: true })
  }

  function setKind(next: Kind, focus = false): void {
    kind = next
    selectedKey = null
    selectedIndex = 0
    for (const candidate of KINDS) {
      const tab = element<HTMLButtonElement>(`tab-kind-${candidate}`)
      tab.setAttribute('aria-selected', String(candidate === next))
      tab.tabIndex = candidate === next ? 0 : -1
    }
    results.setAttribute('aria-labelledby', `tab-kind-${next}`)
    render()
    if (focus) element(`tab-kind-${next}`).focus()
  }

  const closeMenus = (except?: Element): void => {
    root.querySelectorAll<HTMLDetailsElement>('.card-menu[open]').forEach(menu => { if (menu !== except) menu.open = false })
  }

  search.addEventListener('input', () => { query = search.value; selectedKey = null; selectedIndex = 0; render(); reveal() }, { signal })
  search.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); move(event.key === 'ArrowDown' ? 1 : -1); return }
    if (event.key !== 'Enter') return
    const result = selected()
    if (!result) return
    event.preventDefault()
    // A held Enter repeats: closing a tab with its × button gives the focus here, so it would run the next result too.
    if (event.repeat || pending) return
    if (event.altKey) { if (result.kind === 'open') showPreview(result.item, null) }
    else run(result)
  }, { signal })
  KINDS.forEach((candidate, index) => {
    const tab = element<HTMLButtonElement>(`tab-kind-${candidate}`)
    tab.addEventListener('click', () => setKind(candidate), { signal })
    tab.addEventListener('keydown', event => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
      const next = event.key === 'ArrowRight' ? (index + 1) % KINDS.length
        : event.key === 'ArrowLeft' ? (index + KINDS.length - 1) % KINDS.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? KINDS.length - 1 : -1
      if (next >= 0) { event.preventDefault(); setKind(KINDS[next]!, true) }
    }, { signal })
  })
  element('tabs-new-tab').addEventListener('click', () => void act({ kind: 'new-tab' }, 'action'), { signal })

  results.addEventListener('click', event => {
    const control = (event.target as Element).closest<HTMLElement>('[data-tab-action]')
    const holder = control?.closest<HTMLElement>('[data-result-key]')
    if (!control || !holder || (control as HTMLButtonElement).disabled) return
    const key = holder.dataset.resultKey!
    const id = key.slice(key.indexOf(':') + 1)
    const menu = control.closest<HTMLDetailsElement>('.card-menu')
    // A menu closes once one of its actions is chosen, and gives the focus back to its button.
    if (menu) { menu.open = false; menu.querySelector('summary')?.focus({ preventScroll: true }) }
    const tab = state?.tabs.find(candidate => candidate.id === id)
    switch (control.dataset.tabAction) {
      case 'open': void act({ kind: 'open', tabId: id }, 'open'); break
      case 'close': void closeTab(id, control); break
      case 'pin': if (tab) void act({ kind: 'pin', tabId: id, pinned: !tab.pinned }, 'action'); break
      case 'preview': if (tab) showPreview(tab, key); break
      case 'label': startEdit(id); break
      case 'reopen': void act({ kind: 'reopen', closedTabId: id }, 'open'); break
      case 'restore': void act({ kind: 'restore', workspaceId: id }, 'restore'); break
      case 'delete': void deleteArchived(id, control); break
    }
  }, { signal })
  // The label form: typing changes only the draft; Enter saves, Escape cancels.
  results.addEventListener('input', event => {
    const input = event.target as HTMLInputElement
    const key = input.closest<HTMLElement>('.tab-label-form') && input.closest<HTMLElement>('[data-result-key]')?.dataset.resultKey
    const edit = key ? edits.get(key.slice(key.indexOf(':') + 1)) : undefined
    if (edit) edit.draft = input.value
  }, { signal })
  results.addEventListener('submit', event => {
    event.preventDefault()
    const key = (event.target as Element).closest<HTMLElement>('[data-result-key]')?.dataset.resultKey
    if (key) void saveLabel(key.slice(key.indexOf(':') + 1), false)
  }, { signal })
  results.addEventListener('click', event => {
    const control = (event.target as Element).closest<HTMLButtonElement>('[data-label-action]')
    const key = control?.closest<HTMLElement>('[data-result-key]')?.dataset.resultKey
    if (!control || !key || control.disabled || control.type === 'submit') return
    const tabId = key.slice(key.indexOf(':') + 1)
    if (control.dataset.labelAction === 'clear') void saveLabel(tabId, true)
    else if (control.dataset.labelAction === 'cancel') stopEdit(tabId, true)
  }, { signal })
  results.addEventListener('keydown', event => {
    const form = (event.target as Element).closest('.tab-label-form')
    const key = form?.closest<HTMLElement>('[data-result-key]')?.dataset.resultKey
    if (event.key !== 'Escape' || event.isComposing || !key) return
    event.preventDefault()
    stopEdit(key.slice(key.indexOf(':') + 1), true)
  }, { signal })
  // Pointing at a result selects it, as Up and Down do; a page scrolling under a still pointer does not.
  let lastPointer = ''
  results.addEventListener('pointermove', event => {
    const position = `${event.clientX},${event.clientY}`
    if (position === lastPointer) return
    lastPointer = position
    const key = (event.target as Element).closest<HTMLElement>('[data-result-key]')?.dataset.resultKey
    if (!key || key === selectedKey) return
    selectedKey = key
    selectedIndex = order.findIndex(result => keyOf(result.kind, result.item.id) === key)
    renderSelection()
  }, { signal })

  // One card menu at a time; it closes on Escape, a click elsewhere or the focus leaving it.
  root.addEventListener('toggle', event => {
    const opened = event.target as HTMLDetailsElement
    if (opened.classList?.contains('card-menu') && opened.open) closeMenus(opened)
  }, { capture: true, signal })
  // Enter repeats while it is held: a menu's action gives the focus back to the menu's button, so the repeats would
  // open the menu again. A button here takes a new press.
  root.addEventListener('keydown', event => {
    if (event.repeat && event.key === 'Enter' && (event.target as Element).closest('button, summary')) event.preventDefault()
  }, { signal })
  root.addEventListener('keydown', event => {
    const menu = (event.target as Element).closest<HTMLDetailsElement>('.card-menu[open]')
    if (event.key !== 'Escape' || event.isComposing || !menu) return
    event.preventDefault()
    menu.open = false
    menu.querySelector('summary')?.focus()
  }, { signal })
  document.addEventListener('click', event => {
    const open = [...root.querySelectorAll<HTMLDetailsElement>('.card-menu[open]')].filter(menu => !menu.contains(event.target as Node))
    if (!open.length) return
    open.forEach(menu => { menu.open = false })
    // A click outside an open menu only closes it, so it does not open the card under it as well.
    if ((event.target as Element).closest?.('.tab-card-open, .tab-row-open')) { event.preventDefault(); event.stopPropagation() }
  }, { capture: true, signal })
  let pointing = false
  document.addEventListener('pointerdown', () => { pointing = true }, { capture: true, signal })
  document.addEventListener('pointerup', () => { setTimeout(() => { pointing = false }) }, { capture: true, signal })
  root.addEventListener('focusout', event => {
    const menu = (event.target as Element).closest<HTMLDetailsElement>('.card-menu[open]')
    if (menu && !pointing && !menu.contains(event.relatedTarget as Node | null)) menu.open = false
  }, { signal })
  // Escape goes back to the page shown before Home, once a menu, label form, Details or the full-page preview is closed.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented || !visible) return
    if (document.querySelector('.status-details[open]')) return
    event.preventDefault()
    if (event.repeat) return
    if (preview.isOpen()) backToTabs()
    else void act({ kind: 'back' }, 'action')
  }, { signal })

  return {
    /** The counts under the heading: open tabs, archived workspaces and recently closed tabs. */
    summary(): string {
      if (!state) return ''
      const parts = [t('tabSearch.countOpen', { count: number(state.tabs.length) })]
      if (state.archivedWorkspaces.length) parts.push(t('tabSearch.countSaved', { count: number(state.archivedWorkspaces.length) }))
      if (state.closedTabs.length) parts.push(t('tabSearch.countClosed', { count: number(state.closedTabs.length) }))
      return parts.join(' ')
    },
    /** Whether the Tabs view shows; it reads tabs only then. */
    setVisible(next: boolean): void {
      visible = next
      if (next) void read()
      else { closeMenus(); if (preview.isOpen()) { preview.hide(); browse.hidden = false } }
    },
    /** Search tabs: the whole list, the page shown before Home selected, and the search field focused. */
    present(): void {
      query = ''
      search.value = ''
      edits.clear()
      closeMenus()
      error.hidden = true
      if (preview.isOpen()) { preview.hide(); browse.hidden = false }
      setKind('all')
      // Selected once the tabs are read: the ones shown until then may be from an earlier visit, and a read already
      // under way may be too, so it gives way to a new one.
      preferCurrent = true
      ++revision
      // The view starts at its top, so the search field taking the keyboard is in sight, wherever Home was scrolled.
      document.scrollingElement?.scrollTo?.({ top: 0 })
      search.focus({ preventScroll: true })
      search.select()
      void read()
    },
    refresh(): Promise<void> {
      return visible ? read() : Promise.resolve()
    }
  }
}

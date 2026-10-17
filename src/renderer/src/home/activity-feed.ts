import { agentAvatarColorHex } from '../../../shared/agent-presence.js'
import { agentFinishedStepText } from '../../../shared/agent-step-text.js'
import type { HomeBootstrap, HomeFeedEntry } from '../../../shared/home.js'
import { element, interpolate, messageAt, pluralText, timeAgo } from './dom.js'

interface FeedContext {
  /** The open workspace's name, or nothing while Home has not seen it yet. */
  workspaceName: (id: string) => string | undefined
  /** Whether this entry is the request an agent is still waiting on you for. */
  waiting: (entry: HomeFeedEntry) => boolean
  /** The agent's avatar initial while it is connected, as its chip shows it. */
  initial: (entry: HomeFeedEntry) => string | undefined
}

/** Back-to-back identical steps of one agent in one workspace, shown once with how many times. */
interface FeedRun {
  /** The run's oldest entry, so the row keeps its key while newer repeats join it. */
  key: string
  newest: HomeFeedEntry
  ids: string[]
}

const sameStep = (a: HomeFeedEntry, b: HomeFeedEntry): boolean =>
  a.agentKey === b.agentKey && a.workspaceId === b.workspaceId && a.step === b.step && a.target === b.target && a.outcome === b.outcome
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * Home's live activity: agents' finished steps across open workspaces, newest first, in the same plain words as the
 * agent card. Each row opens its workspace through the workspace hub's own `open` action.
 */
export function mountActivityFeed(data: HomeBootstrap) {
  const feed = data.messages.home.mission.feed
  const list = element<HTMLOListElement>('live-activity-list')
  const empty = element('live-activity-empty')
  const rows = new Map<string, { node: HTMLLIElement; signature: string; ids: string[] }>()
  const t = (key: string, values?: Record<string, unknown>): string => messageAt(data.messages, key, values as Record<string, string | number>)
  const agentName = (entry: HomeFeedEntry): string => entry.agentName.trim() || data.messages.shell.agents.unnamed
  const text = (className: string, value: string): HTMLSpanElement => {
    const node = document.createElement('span')
    node.className = className
    node.textContent = value
    return node
  }

  function row(run: FeedRun, name: string | undefined, waiting: boolean, initial: string): HTMLLIElement {
    const entry = run.newest
    const node = document.createElement('li')
    node.className = `feed-row${waiting ? ' needs-you' : ''}${entry.outcome === 'failed' ? ' failed' : ''}`
    node.dataset.feedId = run.key
    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'feed-open'
    open.dataset.workspaceAction = 'open'
    open.dataset.workspaceId = entry.workspaceId
    if (name) open.title = interpolate(data.messages.home.mission.open, { name })
    const avatar = text('feed-avatar', initial)
    avatar.style.setProperty('--agent-color', agentAvatarColorHex(entry.colorIndex))
    avatar.setAttribute('aria-hidden', 'true')
    const words = document.createElement('span')
    words.className = 'feed-words'
    const done = agentFinishedStepText(t, entry)
    words.append(text('feed-step', entry.outcome === 'failed' ? interpolate(data.messages.shell.agentCard.stepFailed, { step: done }) : done))
    // In words, not only in color: which request still waits, and how often a step repeated.
    const notes = [...(waiting ? [data.messages.shell.agents.states.needsYou] : []), ...(run.ids.length > 1 ? [pluralText(data.locale, feed.times, run.ids.length)] : [])]
    if (notes.length) words.append(text('feed-note', notes.join(' · ')))
    words.append(text('feed-meta', ''))
    open.append(avatar, words)
    node.append(open)
    return node
  }

  /** Rows are rebuilt only when what they say changes; their times move on with every read. */
  function update(entries: readonly HomeFeedEntry[], context: FeedContext, now = Date.now()): void {
    const runs: FeedRun[] = []
    for (const entry of entries) {
      if (context.workspaceName(entry.workspaceId) === undefined) continue
      const last = runs.at(-1)
      if (last && sameStep(last.newest, entry)) { last.key = entry.id; last.ids.push(entry.id) }
      else runs.push({ key: entry.id, newest: entry, ids: [entry.id] })
    }
    empty.hidden = runs.length > 0
    list.hidden = !runs.length
    // Keyboard focus follows its steps: into the run that now holds them, or else to the row in the same place.
    const focusedRow = list.contains(document.activeElement) ? (document.activeElement as HTMLElement).closest<HTMLElement>('.feed-row') : null
    const focusedIds = new Set(focusedRow ? rows.get(focusedRow.dataset.feedId ?? '')?.ids ?? [] : [])
    const focusedIndex = focusedRow ? [...list.children].indexOf(focusedRow) : -1
    for (const [key, item] of rows) if (!runs.some(run => run.key === key)) { item.node.remove(); rows.delete(key) }
    runs.forEach((run, index) => {
      const entry = run.newest
      const name = context.workspaceName(entry.workspaceId)
      const waiting = context.waiting(entry)
      const initial = context.initial(entry) || ([...graphemes.segment(agentName(entry))][0]?.segment ?? '·').toLocaleUpperCase()
      const signature = JSON.stringify([entry.agentName, entry.colorIndex, entry.step, entry.target, entry.outcome, run.ids.length, name, waiting, initial])
      let item = rows.get(run.key)
      if (!item || item.signature !== signature) {
        const node = row(run, name, waiting, initial)
        if (item) item.node.replaceWith(node)
        item = { node, signature, ids: run.ids }
        rows.set(run.key, item)
      }
      item.ids = run.ids
      const meta = item.node.querySelector<HTMLElement>('.feed-meta')!
      const next = interpolate(feed.meta, { name: agentName(entry), workspace: name ?? '', time: timeAgo(data.locale, entry.at, now) })
      if (meta.textContent !== next) meta.textContent = next
      if (list.children[index] !== item.node) list.insertBefore(item.node, list.children[index] ?? null)
    })
    // Moving a row can blur it too, so this runs after ordering.
    if (focusedRow && !list.contains(document.activeElement)) {
      const run = focusedRow.isConnected ? null : runs.find(candidate => candidate.ids.some(id => focusedIds.has(id)))
      const target = focusedRow.isConnected ? focusedRow : run ? rows.get(run.key)?.node : list.children[Math.min(focusedIndex, list.children.length - 1)]
      target?.querySelector('button')?.focus({ preventScroll: true })
    }
  }
  return { update }
}

import type { McpTabActivity } from '../../shared/types.js'

const MAX_FOLLOW_ACTIVITIES = 40
/** How long following stays with one agent after its last call, so several agents at once do not bounce the view. */
export const AGENT_FOLLOW_HOLD_MS = 4_000
/** How long following waits after the person types, clicks, scrolls or touches a page. */
export const AGENT_FOLLOW_HUMAN_PAUSE_MS = 3_000

/** The agent whose call an activity is. The id stays in main; the name is the cleaned client name. */
export interface FollowAgent {
  id: string
  name: string
}

/** The tab following brought into view, and the agent it followed there. */
export interface FollowTarget {
  tabId: string
  agent?: FollowAgent
}

interface McpActivityFollowControllerOptions {
  isEnabled: () => boolean
  isOccluded: () => boolean
  getSelectionGeneration: () => number
  tabExists: (tabId: string) => boolean
  canSelectWithoutWake: (tabId: string) => boolean
  wakeTab: (tabId: string) => Promise<unknown>
  /** Shows the tab; false when it was already in view, so the view did not move. */
  selectTabPassively: (tabId: string) => boolean
  /** The tab following shows now, and for which agent. */
  onFollow?: (target: FollowTarget) => void
  onError: (error: unknown) => void
  now?: () => number
}

interface FollowedActivity {
  activity: McpTabActivity
  agent?: FollowAgent
  /** Following has shown this call. */
  shown?: boolean
}

/**
 * Coordinates MCP activity with the visible browser tab without ever taking
 * native window or web-content focus. The manager remains the source of truth
 * for tab selection and trusted-chrome visibility.
 *
 * Following crosses workspaces: the workspace in view is the one of the tab it
 * selects. It stays with the agent it showed until a few seconds after that
 * agent's last call started or finished, and waits while the person types,
 * clicks or scrolls.
 */
export class McpActivityFollowController {
  private readonly activities = new Map<string, FollowedActivity>()
  private generation = 0
  private holder: string | undefined
  private holdUntil = 0
  private holdTimer: NodeJS.Timeout | undefined
  private pausedUntil = 0
  /** The person used a page since following last moved the view, so the end of a hold does not move it. */
  private humanInputSinceFollow = false

  constructor(private readonly options: McpActivityFollowControllerOptions) {}

  accept(activity: McpTabActivity, agent?: FollowAgent): void {
    // Recording and explicit React inspection never wake a page or take the
    // human away from another tab. Ordinary activity state is still published.
    if (activity.suppressFollow || activity.toolName === 'browser_video' || activity.toolName === 'browser_react') return
    // The agent being followed keeps the view while it keeps working.
    if (agent && agent.id === this.holder && this.holding()) this.hold(agent.id, this.now() + AGENT_FOLLOW_HOLD_MS)
    if (activity.phase === 'started') {
      this.activities.delete(activity.activityId)
      this.activities.set(activity.activityId, { activity, ...(agent ? { agent } : {}) })
      // Keep abandoned dispatches from retaining metadata or becoming a later
      // follow target after the recent activity window finishes.
      if (this.activities.size > MAX_FOLLOW_ACTIVITIES) {
        this.activities.delete(this.activities.keys().next().value!)
      }
      this.schedule(this.target())
      return
    }

    this.activities.delete(activity.activityId)
    this.schedule(this.target())
  }

  refresh(): void {
    this.schedule(this.target())
  }

  /**
   * The person typed, clicked, scrolled or touched a page. Following waits a few seconds and then
   * moves only with the agents' next calls, so the view does not jump the moment they stop.
   */
  noteHumanInput(): void {
    this.pausedUntil = this.now() + AGENT_FOLLOW_HUMAN_PAUSE_MS
    this.humanInputSinceFollow = true
    this.generation += 1
  }

  setOccluded(occluded: boolean): void {
    if (occluded) {
      this.generation += 1
      return
    }
    this.schedule(this.target())
  }

  removeTab(tabId: string): void {
    for (const [activityId, entry] of this.activities) {
      if (entry.activity.tabId === tabId) this.activities.delete(activityId)
    }
    this.schedule(this.target())
  }

  dispose(): void {
    this.generation += 1
    this.activities.clear()
    this.release()
  }

  // Monotonic, so a change of the system clock cannot stretch a hold or a pause.
  private now(): number {
    return this.options.now?.() ?? performance.now()
  }

  private holding(): boolean {
    return this.holder !== undefined && this.now() < this.holdUntil
  }

  private hold(agentId: string, until: number): void {
    if (agentId === this.holder && until <= this.holdUntil) return
    this.holder = agentId
    this.holdUntil = until
    if (this.holdTimer) clearTimeout(this.holdTimer)
    // When the hold ends, another agent's call that is still running can take the view, unless the
    // person has used a page since following last moved it.
    this.holdTimer = setTimeout(() => {
      this.holdTimer = undefined
      if (!this.holding() && !this.humanInputSinceFollow) this.refresh()
    }, Math.max(0, until - this.now()) + 1)
    this.holdTimer.unref?.()
  }

  private release(): void {
    this.holder = undefined
    this.holdUntil = 0
    if (this.holdTimer) clearTimeout(this.holdTimer)
    this.holdTimer = undefined
  }

  /** The newest running call to show: while one agent is held, only that agent's. */
  private target(): FollowedActivity | undefined {
    const holder = this.holding() ? this.holder : undefined
    const entries = [...this.activities.values()]
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (!entry || !this.options.tabExists(entry.activity.tabId)) continue
      if (holder !== undefined && entry.agent?.id !== holder) continue
      return entry
    }
    return undefined
  }

  private schedule(entry: FollowedActivity | undefined): void {
    const generation = ++this.generation
    if (
      !entry
      || !this.options.isEnabled()
      || this.options.isOccluded()
      || this.now() < this.pausedUntil
      || !this.options.tabExists(entry.activity.tabId)
    ) return

    const selectionGeneration = this.options.getSelectionGeneration()
    if (this.options.canSelectWithoutWake(entry.activity.tabId)) {
      this.selectIfCurrent(entry, generation, selectionGeneration)
      return
    }
    void this.options.wakeTab(entry.activity.tabId).then(() => {
      this.selectIfCurrent(entry, generation, selectionGeneration)
    }).catch(this.options.onError)
  }

  private selectIfCurrent(
    entry: FollowedActivity,
    generation: number,
    selectionGeneration: number
  ): void {
    if (
      generation !== this.generation
      || !this.options.isEnabled()
      || this.options.isOccluded()
      || this.now() < this.pausedUntil
      || !this.options.tabExists(entry.activity.tabId)
      || this.options.getSelectionGeneration() !== selectionGeneration
      || this.target()?.activity.activityId !== entry.activity.activityId
    ) return

    let moved: boolean
    try {
      moved = this.options.selectTabPassively(entry.activity.tabId)
    } catch (error) {
      this.options.onError(error)
      return
    }
    // A tab already in view leaves the view as it was, so the person's use of a page since following
    // last moved it still keeps another agent from taking the view when this hold ends.
    if (moved) this.humanInputSinceFollow = false
    // Showing a call again, such as one still running when a hold ends or one that never finishes,
    // does not renew the hold: only a call shown for the first time does, or the agent's own calls.
    const shownBefore = entry.shown === true
    entry.shown = true
    if (!entry.agent) this.release()
    else if (!shownBefore) this.hold(entry.agent.id, this.now() + AGENT_FOLLOW_HOLD_MS)
    try {
      this.options.onFollow?.({ tabId: entry.activity.tabId, ...(entry.agent ? { agent: entry.agent } : {}) })
    } catch (error) {
      this.options.onError(error)
    }
  }
}

import type { McpTabActivity } from '../../shared/types.js'

interface McpActivityFollowControllerOptions {
  isEnabled: () => boolean
  isOccluded: () => boolean
  getSelectionGeneration: () => number
  tabExists: (tabId: string) => boolean
  wakeTab: (tabId: string) => Promise<unknown>
  selectTabPassively: (tabId: string) => unknown
  onError: (error: unknown) => void
}

/**
 * Coordinates MCP activity with the visible browser tab without ever taking
 * native window or web-content focus. The manager remains the source of truth
 * for tab selection and trusted-chrome visibility.
 */
export class McpActivityFollowController {
  private readonly activities = new Map<string, McpTabActivity>()
  private generation = 0

  constructor(private readonly options: McpActivityFollowControllerOptions) {}

  accept(activity: McpTabActivity): void {
    if (activity.phase === 'started') {
      this.activities.delete(activity.activityId)
      this.activities.set(activity.activityId, activity)
      this.schedule(activity)
      return
    }

    this.activities.delete(activity.activityId)
    this.schedule(this.latestActivity())
  }

  refresh(): void {
    this.schedule(this.latestActivity())
  }

  setOccluded(occluded: boolean): void {
    if (occluded) {
      this.generation += 1
      return
    }
    this.schedule(this.latestActivity())
  }

  removeTab(tabId: string): void {
    for (const [activityId, activity] of this.activities) {
      if (activity.tabId === tabId) this.activities.delete(activityId)
    }
    this.schedule(this.latestActivity())
  }

  dispose(): void {
    this.generation += 1
    this.activities.clear()
  }

  private latestActivity(): McpTabActivity | undefined {
    const activities = [...this.activities.values()]
    for (let index = activities.length - 1; index >= 0; index -= 1) {
      const activity = activities[index]
      if (activity && this.options.tabExists(activity.tabId)) return activity
    }
    return undefined
  }

  private schedule(activity: McpTabActivity | undefined): void {
    const generation = ++this.generation
    if (!activity) return

    const selectionGeneration = this.options.getSelectionGeneration()
    void this.options.wakeTab(activity.tabId).then(() => {
      if (
        generation !== this.generation
        || !this.options.isEnabled()
        || this.options.isOccluded()
        || !this.options.tabExists(activity.tabId)
        || this.options.getSelectionGeneration() !== selectionGeneration
        || this.latestActivity()?.activityId !== activity.activityId
      ) return

      this.options.selectTabPassively(activity.tabId)
    }).catch(this.options.onError)
  }
}

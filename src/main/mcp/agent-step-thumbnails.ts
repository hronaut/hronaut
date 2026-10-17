import type { AgentStepReference, AgentStepThumbnailImage } from './agent-presence.js'

/** A step's picture waits until its tab has been quiet this long, so it shows what the step left behind. */
export const AGENT_STEP_THUMBNAIL_SETTLE_MS = 400
/** A tab that is still loading is tried again this many times, one settle apart, then the step goes without. */
export const AGENT_STEP_THUMBNAIL_ATTEMPTS = 6

/**
 * Takes a tab's picture for a step in a workspace: undefined when it cannot be taken cheaply now (the tab is not on
 * screen or not in that workspace), 'later' while its page is still loading or another capture of it is running.
 */
export type AgentStepThumbnailCapture = (tabId: string, workspaceId: string) => Promise<AgentStepThumbnailImage | 'later' | undefined>

interface PendingThumbnail {
  timer: NodeJS.Timeout
  step: AgentStepReference
  attempts: number
}

/**
 * Pictures the newest step on each tab once that tab settles. A burst of steps on one tab gets one picture, on its
 * last step. Every timer is unreferenced and cleared by clear().
 */
export class AgentStepThumbnailScheduler {
  private readonly pending = new Map<string, PendingThumbnail>()
  private generation = 0

  constructor(
    private readonly capture: AgentStepThumbnailCapture,
    private readonly attach: (step: AgentStepReference, thumbnail: AgentStepThumbnailImage) => void,
    private readonly settleMs = AGENT_STEP_THUMBNAIL_SETTLE_MS
  ) {}

  /** A step finished on this tab; it replaces any step still waiting there. */
  request(tabId: string, step: AgentStepReference): void {
    this.schedule(tabId, step, 0)
  }

  /** Forgets every waiting step; a capture already running attaches nothing. */
  clear(): void {
    this.generation += 1
    for (const { timer } of this.pending.values()) clearTimeout(timer)
    this.pending.clear()
  }

  private schedule(tabId: string, step: AgentStepReference, attempts: number): void {
    const existing = this.pending.get(tabId)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(() => { void this.fire(tabId, timer) }, this.settleMs)
    timer.unref?.()
    this.pending.set(tabId, { timer, step, attempts })
  }

  private async fire(tabId: string, timer: NodeJS.Timeout): Promise<void> {
    const entry = this.pending.get(tabId)
    if (!entry || entry.timer !== timer) return
    this.pending.delete(tabId)
    const generation = this.generation
    let result: AgentStepThumbnailImage | 'later' | undefined
    try {
      result = await this.capture(tabId, entry.step.workspaceId)
    } catch {
      return
    }
    if (generation !== this.generation) return
    if (result === 'later') {
      // A newer step on this tab took over meanwhile and has its own timer.
      if (!this.pending.has(tabId) && entry.attempts + 1 < AGENT_STEP_THUMBNAIL_ATTEMPTS) this.schedule(tabId, entry.step, entry.attempts + 1)
      return
    }
    if (result) this.attach(entry.step, result)
  }
}

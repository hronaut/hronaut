import type { DetachablePanelId } from '../shared/types.js'

// The shell waits for settings before mounting its panel listener. Retain one
// latest presentation request across that gap instead of losing startup IPC.
export function createPanelRequestBuffer() {
  const listeners = new Set<(panel: DetachablePanelId) => void>()
  let pending: DetachablePanelId | undefined

  function receive(panel: DetachablePanelId): void {
    if (listeners.size === 0) {
      pending = panel
      return
    }
    for (const listener of [...listeners]) listener(panel)
  }

  function subscribe(listener: (panel: DetachablePanelId) => void): () => void {
    const subscription = (panel: DetachablePanelId): void => listener(panel)
    listeners.add(subscription)
    const panel = pending
    pending = undefined
    try {
      if (panel !== undefined) listener(panel)
    } catch (error) {
      listeners.delete(subscription)
      throw error
    }
    return () => { listeners.delete(subscription) }
  }

  return { receive, subscribe }
}

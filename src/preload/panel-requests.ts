import type { DetachablePanelId } from '../shared/types.js'

// The shell waits for settings before mounting its listeners. Retain one
// latest request across that gap instead of losing startup IPC: the panel a
// new panel window shows, or the Bookmark all tabs it was opened to ask for.
export function createPanelRequestBuffer<Request = DetachablePanelId>() {
  const listeners = new Set<(request: Request) => void>()
  let pending: { request: Request } | undefined

  function receive(request: Request): void {
    if (listeners.size === 0) {
      pending = { request }
      return
    }
    for (const listener of [...listeners]) listener(request)
  }

  function subscribe(listener: (request: Request) => void): () => void {
    const subscription = (request: Request): void => listener(request)
    listeners.add(subscription)
    const waiting = pending
    pending = undefined
    try {
      if (waiting) listener(waiting.request)
    } catch (error) {
      listeners.delete(subscription)
      throw error
    }
    return () => { listeners.delete(subscription) }
  }

  return { receive, subscribe }
}

export function createFeedbackTimerRegistry<Key>() {
  const timers = new Map<Key, number>()

  function clear(key: Key): void {
    const timer = timers.get(key)
    if (timer !== undefined) window.clearTimeout(timer)
    timers.delete(key)
  }

  function schedule(key: Key, callback: () => void, delay = 1_500): void {
    clear(key)
    const timer = window.setTimeout(() => {
      if (timers.get(key) !== timer) return
      timers.delete(key)
      callback()
    }, delay)
    timers.set(key, timer)
  }

  function clearAll(): void {
    for (const timer of timers.values()) window.clearTimeout(timer)
    timers.clear()
  }

  return { schedule, clear, clearAll }
}

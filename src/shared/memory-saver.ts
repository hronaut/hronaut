export const MEMORY_SAVER_TIMEOUT_MINUTES = [5, 15, 30, 60, 120, 240] as const

export type MemorySaverTimeoutMinutes = (typeof MEMORY_SAVER_TIMEOUT_MINUTES)[number]

export const DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES: MemorySaverTimeoutMinutes = 60

export function isMemorySaverTimeoutMinutes(value: unknown): value is MemorySaverTimeoutMinutes {
  return typeof value === 'number'
    && MEMORY_SAVER_TIMEOUT_MINUTES.includes(value as MemorySaverTimeoutMinutes)
}

export function memorySaverCutoff(now: number, timeoutMinutes: MemorySaverTimeoutMinutes): number {
  return now - timeoutMinutes * 60_000
}

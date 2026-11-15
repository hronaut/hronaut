/** The storage manager's estimate of the origin's usage and quota. */
export interface StorageEstimateAnswer {
  usage?: number
  quota?: number
  usageDetails?: Record<string, number>
}

/** Runs in the page: the storage manager's estimate of its origin's usage, or null when it has none or cannot give it. */
export function storageEstimateInPage(): Promise<StorageEstimateAnswer | null> {
  const storage = navigator.storage as StorageManager | undefined
  return storage?.estimate?.().then((value) => ({
    usage: value.usage,
    quota: value.quota,
    usageDetails: (value as { usageDetails?: Record<string, number> }).usageDetails
  })).catch(() => null) ?? Promise.resolve(null)
}

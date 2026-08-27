export interface CredentialFillPauseOptions<T> {
  pausePersistently: () => void
  acquireTemporaryPause: () => () => void
  getActiveRequestCount: () => number
  fill: () => Promise<T>
  timeoutMs?: number
  pollIntervalMs?: number
  now?: () => number
  wait?: (milliseconds: number) => Promise<void>
}

export async function fillCredentialWhileMcpPaused<T>(
  options: CredentialFillPauseOptions<T>
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 5_000
  const pollIntervalMs = options.pollIntervalMs ?? 25
  const now = options.now ?? Date.now
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))

  options.pausePersistently()
  const releaseTemporaryPause = options.acquireTemporaryPause()
  try {
    const waitStartedAt = now()
    while (options.getActiveRequestCount() > 0 && now() - waitStartedAt < timeoutMs) {
      await wait(pollIntervalMs)
    }
    if (options.getActiveRequestCount() > 0) {
      throw new Error('Could not fill the password while an MCP command was still active')
    }
    return await options.fill()
  } finally {
    releaseTemporaryPause()
  }
}

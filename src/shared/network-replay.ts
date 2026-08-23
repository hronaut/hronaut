const SAFE_REPLAY_METHODS = new Set(['GET', 'HEAD'])

export function networkReplayRequiresConfirmation(method: string): boolean {
  return !SAFE_REPLAY_METHODS.has(method.trim().toUpperCase())
}

export function networkReplayUrlPattern(url: string): string {
  return url.replace(/[\\*?]/g, (character) => `\\${character}`)
}

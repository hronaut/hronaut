export class McpPauseState {
  private persistentPaused = false
  private readonly temporaryLeases = new Set<symbol>()

  get paused(): boolean {
    return this.persistentPaused || this.temporaryLeases.size > 0
  }

  setPersistent(paused: boolean): void {
    this.persistentPaused = paused
  }

  acquireTemporary(): () => void {
    const lease = Symbol('mcp-temporary-pause')
    let released = false
    this.temporaryLeases.add(lease)
    return () => {
      if (released) return
      released = true
      this.temporaryLeases.delete(lease)
    }
  }
}

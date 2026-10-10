interface RecoveryContents {
  isDestroyed(): boolean
  forcefullyCrashRenderer(): void
  on(event: 'render-process-gone' | 'destroyed', listener: () => void): unknown
  on(event: 'did-start-navigation', listener: (event: unknown, url: string, sameDocument: boolean, mainFrame: boolean) => void): unknown
  removeListener(event: 'render-process-gone' | 'destroyed', listener: () => void): unknown
  removeListener(event: 'did-start-navigation', listener: (event: unknown, url: string, sameDocument: boolean, mainFrame: boolean) => void): unknown
}

/** Own only the intentional exit, never subsequent replacement-renderer exits. */
export class RendererRecovery {
  private readonly pending = new WeakMap<RecoveryContents, { expectsExit: boolean }>()

  isRecovering(contents: RecoveryContents): boolean {
    return this.pending.has(contents)
  }

  expectsExit(contents: RecoveryContents): boolean {
    return this.pending.get(contents)?.expectsExit === true
  }

  async recover(contents: RecoveryContents, loadReplacement: () => Promise<void>): Promise<void> {
    if (this.isRecovering(contents)) throw new Error('The tab renderer is already being recovered.')
    const attempt = { expectsExit: true }
    this.pending.set(contents, attempt)
    let rejectFailure!: (error: unknown) => void
    let resolveExit!: () => void
    const failed = new Promise<never>((_resolve, reject) => { rejectFailure = reject })
    const exited = new Promise<void>(resolve => { resolveExit = resolve })
    const stopExpectingExit = (): void => {
      attempt.expectsExit = false
      contents.removeListener('render-process-gone', onExit)
      contents.removeListener('did-start-navigation', onNavigation)
    }
    const fail = (error: Error): void => {
      stopExpectingExit()
      rejectFailure(error)
    }
    const onExit = (): void => {
      stopExpectingExit()
      resolveExit()
    }
    const onDestroyed = (): void => fail(new Error('The tab closed while recovering its renderer.'))
    const onNavigation = (_event: unknown, _url: string, _sameDocument: boolean, mainFrame: boolean): void => {
      if (mainFrame) fail(new Error('The page changed while recovering its renderer.'))
    }
    // One deadline covers both termination and replacement loading.
    const timer = setTimeout(() => fail(new Error('Timed out recovering the tab renderer.')), 30_000)
    contents.on('render-process-gone', onExit)
    contents.on('destroyed', onDestroyed)
    contents.on('did-start-navigation', onNavigation)
    try {
      if (contents.isDestroyed()) throw new Error('The tab closed while recovering its renderer.')
      contents.forcefullyCrashRenderer()
      await Promise.race([exited, failed])
      if (contents.isDestroyed()) throw new Error('The tab closed while recovering its renderer.')
      await Promise.race([loadReplacement(), failed])
    } finally {
      clearTimeout(timer)
      stopExpectingExit()
      contents.removeListener('destroyed', onDestroyed)
      if (this.pending.get(contents) === attempt) this.pending.delete(contents)
    }
  }
}

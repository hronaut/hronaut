import { describe, expect, it } from 'vitest'
import { createWorkspaceOriginLoader } from '../../src/renderer/src/composables/useWorkspaceOriginLoader.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('workspace origin loader', () => {
  it('ignores an older origin list that resolves after the transfer direction changes', async () => {
    const defaultOrigins = deferred<string[]>()
    const workspaceOrigins = deferred<string[]>()
    const loader = createWorkspaceOriginLoader((workspaceId) => (
      workspaceId === 'default' ? defaultOrigins.promise : workspaceOrigins.promise
    ))

    const importing = loader.load('default')
    const saving = loader.load('workspace')
    workspaceOrigins.resolve(['https://workspace.example'])
    expect(await saving).toEqual({ status: 'ready', origins: ['https://workspace.example'] })

    defaultOrigins.resolve(['https://default.example'])
    expect(await importing).toEqual({ status: 'stale' })
  })

  it('ignores a rejected request after the workspace editor closes', async () => {
    const pending = deferred<string[]>()
    const loader = createWorkspaceOriginLoader(() => pending.promise)
    const loading = loader.load('workspace')

    loader.invalidate()
    pending.reject(new Error('late IPC failure'))

    expect(await loading).toEqual({ status: 'stale' })
  })
})

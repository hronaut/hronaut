import { describe, expect, it } from 'vitest'
import { currentAuditAction, withAuditAction } from '../src/main/mcp/audit-action-context.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('action receipt correlation', () => {
  it('does not guess an action for native or unrelated callbacks', async () => {
    const entered = deferred()
    const finish = deferred()
    const action = withAuditAction('workspace-a', async (id) => {
      expect(currentAuditAction('workspace-a')).toBe(id)
      expect(currentAuditAction('workspace-b')).toBeNull()
      entered.resolve()
      await finish.promise
      expect(currentAuditAction('workspace-a')).toBe(id)
    })
    await entered.promise
    expect(currentAuditAction('workspace-a')).toBeNull()
    finish.resolve()
    await action
    expect(currentAuditAction('workspace-a')).toBeNull()
  })

  it('keeps concurrent actions distinct even in the same workspace', async () => {
    const entered = deferred()
    const finish = deferred()
    let firstId = ''
    const first = withAuditAction('workspace-a', async (id) => {
      firstId = id
      entered.resolve()
      await finish.promise
      expect(currentAuditAction('workspace-a')).toBe(id)
    })
    await entered.promise
    await withAuditAction('workspace-a', async (secondId) => {
      expect(secondId).not.toBe(firstId)
      await Promise.resolve()
      expect(currentAuditAction('workspace-a')).toBe(secondId)
    })
    finish.resolve()
    await first
  })

  it('restores the outer correlation after a nested action fails', async () => {
    await withAuditAction('workspace-a', async (outerId) => {
      await expect(withAuditAction('workspace-b', async (innerId) => {
        expect(currentAuditAction('workspace-a')).toBeNull()
        expect(currentAuditAction('workspace-b')).toBe(innerId)
        throw new Error('test failure')
      })).rejects.toThrow('test failure')
      expect(currentAuditAction('workspace-a')).toBe(outerId)
      expect(currentAuditAction('workspace-b')).toBeNull()
    })
  })

  it.each([false, true])('drops late detached callbacks after the action settles (failure=%s)', async (fail) => {
    const finishDetached = deferred()
    let detached!: Promise<string | null>
    const action = withAuditAction('workspace-a', async () => {
      detached = finishDetached.promise.then(() => currentAuditAction('workspace-a'))
      if (fail) throw new Error('test failure')
    })
    if (fail) await expect(action).rejects.toThrow('test failure')
    else await action
    finishDetached.resolve()
    expect(await detached).toBeNull()
  })
})

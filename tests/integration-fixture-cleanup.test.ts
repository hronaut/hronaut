import { describe, expect, it, vi } from 'vitest'
import { removeTestDirectory } from './helpers/remove-test-directory.js'

describe('integration fixture cleanup', () => {
  it('retries transient non-empty Chromium profile directories', async () => {
    const remove = vi.fn(async () => undefined)

    await removeTestDirectory('/tmp/hronaut-integration-test', remove)

    expect(remove).toHaveBeenCalledWith('/tmp/hronaut-integration-test', {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100
    })
  })
})

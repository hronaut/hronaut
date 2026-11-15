import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { frameStream, frameStreamFields } from '../src/main/browser/frame-stream/frame-stream.js'
import type { Browser } from '../src/main/browser/browser.js'

const schema = z.object({ tabId: z.string(), ...frameStreamFields }).strict()

describe('page frame stream input', () => {
  it.each([
    { action: 'watch' }, { action: 'start', maxWidth: 1281 }, { action: 'start', maxHeight: 721 }, { action: 'start', quality: 0 },
    { action: 'start', everyNthFrame: 11 }, { action: 'start', bufferFrames: 31 }, { action: 'read', maxFrames: 5 },
    { action: 'read', waitMs: 2001 }, { action: 'read', after: -1 }, { action: 'read', after: 1.5 }, { action: 'start', format: 'png' }
  ])('rejects %j', input => {
    expect(schema.safeParse({ tabId: 'tab', ...input }).success).toBe(false)
  })

  it.each([
    [{ action: 'read', quality: 50 }, 'Action read does not take quality'],
    [{ action: 'start', after: 3 }, 'Action start does not take after'],
    [{ action: 'stop', waitMs: 10 }, 'Action stop does not take waitMs']
  ] as const)('refuses options of another action %j before touching the page', async (input, message) => {
    await expect(frameStream({} as Browser, { tabId: 'tab', ...input }, () => undefined)).rejects.toThrow(message)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentStepThumbnailImage } from '../src/main/mcp/agent-presence.js'
import {
  AGENT_STEP_THUMBNAIL_ATTEMPTS,
  AGENT_STEP_THUMBNAIL_SETTLE_MS,
  AgentStepThumbnailScheduler,
  type AgentStepThumbnailCapture
} from '../src/main/mcp/agent-step-thumbnails.js'

const picture: AgentStepThumbnailImage = { jpeg: Buffer.from([0xff, 0xd8]), width: 320, height: 200 }
const step = (stepId: string) => ({ sessionId: 'session-1', workspaceId: 'workspace-1', stepId })

describe('agent step thumbnails', () => {
  afterEach(() => { vi.useRealTimers() })

  it('pictures the newest step of a burst on a tab once the tab settles, and each tab on its own', async () => {
    vi.useFakeTimers()
    const capture = vi.fn<AgentStepThumbnailCapture>(async () => picture)
    const attach = vi.fn()
    const scheduler = new AgentStepThumbnailScheduler(capture, attach)
    scheduler.request('tab-1', step('s1'))
    await vi.advanceTimersByTimeAsync(AGENT_STEP_THUMBNAIL_SETTLE_MS - 1)
    scheduler.request('tab-1', step('s2'))
    scheduler.request('tab-2', step('s3'))
    await vi.advanceTimersByTimeAsync(AGENT_STEP_THUMBNAIL_SETTLE_MS - 1)
    expect(capture).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(capture.mock.calls).toEqual([['tab-1', 'workspace-1'], ['tab-2', 'workspace-1']])
    expect(attach.mock.calls).toEqual([[step('s2'), picture], [step('s3'), picture]])
  })

  it('tries a loading page again a few times, then gives up, and lets a newer step take over', async () => {
    vi.useFakeTimers()
    const capture = vi.fn<AgentStepThumbnailCapture>(async () => 'later')
    const attach = vi.fn()
    const scheduler = new AgentStepThumbnailScheduler(capture, attach)
    scheduler.request('tab-1', step('s1'))
    await vi.advanceTimersByTimeAsync(AGENT_STEP_THUMBNAIL_SETTLE_MS * (AGENT_STEP_THUMBNAIL_ATTEMPTS + 3))
    expect(capture).toHaveBeenCalledTimes(AGENT_STEP_THUMBNAIL_ATTEMPTS)
    expect(attach).not.toHaveBeenCalled()

    capture.mockClear()
    capture.mockResolvedValueOnce('later').mockResolvedValue(picture)
    scheduler.request('tab-1', step('s2'))
    await vi.advanceTimersByTimeAsync(AGENT_STEP_THUMBNAIL_SETTLE_MS)
    // While the retry waits, a newer step on the same tab replaces it.
    scheduler.request('tab-1', step('s3'))
    await vi.advanceTimersByTimeAsync(AGENT_STEP_THUMBNAIL_SETTLE_MS * 3)
    expect(capture).toHaveBeenCalledTimes(2)
    expect(attach.mock.calls).toEqual([[step('s3'), picture]])
  })

  it('leaves a loading page to a newer step that arrived on its tab during the capture', async () => {
    vi.useFakeTimers()
    let answer!: (value: 'later') => void
    const capture = vi.fn<AgentStepThumbnailCapture>()
      .mockImplementationOnce(() => new Promise((resolve) => { answer = resolve }))
      .mockResolvedValue(picture)
    const attach = vi.fn()
    const scheduler = new AgentStepThumbnailScheduler(capture, attach)
    scheduler.request('tab-1', step('s1'))
    await vi.advanceTimersByTimeAsync(AGENT_STEP_THUMBNAIL_SETTLE_MS)
    scheduler.request('tab-1', step('s2'))
    answer('later')
    await vi.advanceTimersByTimeAsync(AGENT_STEP_THUMBNAIL_SETTLE_MS * 3)
    expect(capture).toHaveBeenCalledTimes(2)
    expect(attach.mock.calls).toEqual([[step('s2'), picture]])
  })

  it('attaches nothing when the tab cannot be pictured, the capture fails, or it was cleared meanwhile', async () => {
    vi.useFakeTimers()
    let finish!: (value: AgentStepThumbnailImage) => void
    const capture = vi.fn<AgentStepThumbnailCapture>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('capture failed'))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const attach = vi.fn()
    const scheduler = new AgentStepThumbnailScheduler(capture, attach)
    scheduler.request('tab-1', step('s1'))
    await vi.advanceTimersByTimeAsync(AGENT_STEP_THUMBNAIL_SETTLE_MS)
    scheduler.request('tab-1', step('s2'))
    await vi.advanceTimersByTimeAsync(AGENT_STEP_THUMBNAIL_SETTLE_MS)
    scheduler.request('tab-1', step('s3'))
    await vi.advanceTimersByTimeAsync(AGENT_STEP_THUMBNAIL_SETTLE_MS)
    expect(capture).toHaveBeenCalledTimes(3)
    // The server stopped while the capture ran, and a waiting step is forgotten too.
    scheduler.request('tab-2', step('s4'))
    scheduler.clear()
    finish(picture)
    await vi.advanceTimersByTimeAsync(AGENT_STEP_THUMBNAIL_SETTLE_MS * 2)
    expect(capture).toHaveBeenCalledTimes(3)
    expect(attach).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

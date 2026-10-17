import { describe, expect, it } from 'vitest'
import { HomeActivityFeed } from '../src/main/mcp/home-activity-feed.js'
import { HOME_ACTIVITY_FEED_LIMIT } from '../src/shared/home.js'

const entry = (workspaceId: string, at: number) => ({
  agentKey: 'key', agentName: 'Claude Code', colorIndex: 1, workspaceId, step: 'click' as const, outcome: 'done' as const, at
})

describe('Home activity feed', () => {
  it('lists the newest steps first, keeps at most the limit and hands out copies', () => {
    const feed = new HomeActivityFeed()
    for (let index = 0; index < HOME_ACTIVITY_FEED_LIMIT + 5; index++) feed.add(entry('a', index))
    const listed = feed.list()
    expect(listed).toHaveLength(HOME_ACTIVITY_FEED_LIMIT)
    expect(listed[0]?.at).toBe(HOME_ACTIVITY_FEED_LIMIT + 4)
    expect(listed.at(-1)?.at).toBe(5)
    expect(new Set(listed.map((item) => item.id)).size).toBe(HOME_ACTIVITY_FEED_LIMIT)
    listed[0]!.agentName = 'changed'
    expect(feed.list()[0]?.agentName).toBe('Claude Code')
  })

  it('forgets a workspace or everything, counting a change only when something went', () => {
    const feed = new HomeActivityFeed()
    feed.add(entry('a', 1)); feed.add(entry('b', 2))
    const revision = feed.revision
    feed.forgetWorkspace('missing')
    expect(feed.revision).toBe(revision)
    feed.forgetWorkspace('a')
    expect(feed.list().map((item) => item.workspaceId)).toEqual(['b'])
    feed.clear()
    expect(feed.list()).toEqual([])
    expect(feed.revision).toBe(revision + 2)
  })
})

import { describe, expect, it } from 'vitest'
import { createPermissionDismissals } from '../src/main/site-data/permission-dismissals.js'

const WORK = '01912345-6789-7abc-8def-0123456789ab'
const CLIENT = '01912345-678a-7abc-8def-0123456789ab'
const WEEK = 7 * 24 * 60 * 60 * 1_000
const maps = { workspaceId: WORK, origin: 'https://maps.example', permission: 'geolocation' }

describe('closed permission prompts', () => {
  it('refuse a website without asking for a week once its prompt was closed three times', () => {
    let now = 1_000
    const dismissals = createPermissionDismissals(() => now)
    dismissals.dismissed(maps)
    dismissals.dismissed(maps)
    expect(dismissals.embargoed(maps)).toBe(false)
    dismissals.dismissed(maps)
    expect(dismissals.embargoed(maps)).toBe(true)
    now += WEEK - 1
    expect(dismissals.embargoed(maps)).toBe(true)
    now += 1
    expect(dismissals.embargoed(maps)).toBe(false)
    // The week over, it counts from none again.
    dismissals.dismissed(maps)
    expect(dismissals.embargoed(maps)).toBe(false)
  })

  it('keep each workspace, website, permission and embedding page apart', () => {
    const dismissals = createPermissionDismissals(() => 0)
    for (let index = 0; index < 3; index += 1) dismissals.dismissed(maps)
    expect(dismissals.embargoed(maps)).toBe(true)
    expect(dismissals.embargoed({ ...maps, workspaceId: CLIENT })).toBe(false)
    expect(dismissals.embargoed({ ...maps, origin: 'https://other.example' })).toBe(false)
    expect(dismissals.embargoed({ ...maps, permission: 'notifications' })).toBe(false)
    expect(dismissals.embargoed({ ...maps, embeddedIn: 'https://news.example' })).toBe(false)
  })

  it('count from none again after an answer, and forget a removed workspace’s', () => {
    const dismissals = createPermissionDismissals(() => 0)
    dismissals.dismissed(maps)
    dismissals.dismissed(maps)
    dismissals.answered(maps)
    dismissals.dismissed(maps)
    expect(dismissals.embargoed(maps)).toBe(false)

    const client = { ...maps, workspaceId: CLIENT }
    for (let index = 0; index < 3; index += 1) {
      dismissals.dismissed(maps)
      dismissals.dismissed(client)
    }
    dismissals.forgetWorkspace(CLIENT)
    expect(dismissals.embargoed(client)).toBe(false)
    expect(dismissals.embargoed(maps)).toBe(true)
  })

  it('keep at most 1,000 websites, forgetting the least recently closed first', () => {
    const dismissals = createPermissionDismissals(() => 0)
    const site = (index: number) => ({ ...maps, origin: `https://site-${index}.example` })
    for (let index = 0; index < 3; index += 1) dismissals.dismissed(site(0))
    for (let index = 1; index < 1_000; index += 1) dismissals.dismissed(site(index))
    expect(dismissals.embargoed(site(0))).toBe(true)
    // Closing the first one again makes it the most recent, so the next one forgets the second.
    dismissals.dismissed(site(0))
    dismissals.dismissed(site(1_000))
    expect(dismissals.embargoed(site(0))).toBe(true)
    for (let index = 0; index < 2; index += 1) dismissals.dismissed(site(1))
    expect(dismissals.embargoed(site(1))).toBe(false)
  })
})

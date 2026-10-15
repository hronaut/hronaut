import { describe, expect, it } from 'vitest'
import { MAX_REPORTED_OPENED_TABS, OpenedTabObservation, recheckOpenedTabs } from '../src/main/browser/click-opened-tabs.js'

describe('tabs opened during a click', () => {
  it('reports nothing when the source tab asked to open no tab', () => {
    expect(new OpenedTabObservation().stop(() => true)).toBeUndefined()
  })

  it('lists created tabs and separates blocked, failed and pending requests', () => {
    const observation = new OpenedTabObservation()
    observation.creationStarted().created('tab-1')
    observation.blockedRequest()
    observation.failedRequest()
    observation.creationStarted().failed()
    observation.creationStarted()

    expect(observation.stop(() => true)).toEqual({ tabIds: ['tab-1'], blocked: 1, failed: 2, pending: 1 })
  })

  it('bounds the listed tabs and counts the rest', () => {
    const observation = new OpenedTabObservation()
    for (let index = 0; index < MAX_REPORTED_OPENED_TABS + 2; index += 1) observation.creationStarted().created(`tab-${index}`)

    const report = observation.stop(() => true)

    expect(report?.tabIds).toHaveLength(MAX_REPORTED_OPENED_TABS)
    expect(report?.tabIds[0]).toBe('tab-0')
    expect(report?.more).toBe(2)
  })

  it('omits tabs that were closed or moved before the click returned', () => {
    const observation = new OpenedTabObservation()
    observation.creationStarted().created('kept')
    observation.creationStarted().created('closed')

    expect(observation.stop(tabId => tabId === 'kept')).toEqual({ tabIds: ['kept'], closed: 1 })
  })

  it('ignores requests and creations that settle after the click returned', () => {
    const observation = new OpenedTabObservation()
    const late = observation.creationStarted()
    expect(observation.stop(() => true)).toEqual({ tabIds: [], pending: 1 })

    late.created('late-tab')
    observation.blockedRequest()
    observation.creationStarted().created('after-stop')

    expect(observation.stop(() => true)).toEqual({ tabIds: [], pending: 1 })
  })

  it('counts one creation once even if it reports both outcomes', () => {
    const observation = new OpenedTabObservation()
    const creation = observation.creationStarted()
    creation.created('tab-1')
    creation.failed()

    expect(observation.stop(() => true)).toEqual({ tabIds: ['tab-1'] })
  })

  it('drops tabs closed before publication and keeps the other counts', () => {
    expect(recheckOpenedTabs({ tabIds: ['kept', 'closed'], more: 1, closed: 1, blocked: 2 }, tabId => tabId === 'kept'))
      .toEqual({ tabIds: ['kept'], more: 1, closed: 2, blocked: 2 })
  })
})

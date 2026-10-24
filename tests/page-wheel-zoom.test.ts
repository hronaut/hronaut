import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { attachPageWheelZoom } from '../src/main/browser/page-zoom/page-wheel-zoom.js'
import type { PageWheelZoomAccess, PageWheelZoomTab } from '../src/main/browser/page-zoom/page-wheel-zoom-access.js'
import { setZoom } from '../src/main/browser/page-zoom/page-zoom.js'
import type { BrowserState } from '../src/shared/types.js'

interface ZoomTab extends PageWheelZoomTab {
  nativeInputEnvironmentGeneration: number
}

function page(): WebContents & EventEmitter {
  let factor = 1
  return Object.assign(new EventEmitter(), {
    id: 41,
    isDestroyed: () => false,
    getZoomFactor: () => factor,
    setZoomFactor: (next: number) => { factor = next }
  }) as unknown as WebContents & EventEmitter
}

function attached(url: string, overrides: Partial<PageWheelZoomAccess<ZoomTab>> = {}) {
  const webContents = page()
  const tab: ZoomTab = { id: 'tab', url, webContents, nativeInputEnvironmentGeneration: 0 }
  const changed = vi.fn()
  const access: PageWheelZoomAccess<ZoomTab> = {
    findTab: (tabId) => tabId === tab.id ? tab : undefined,
    browserContentOccluded: () => false,
    isHumanInteractionLocked: () => false,
    agentInputWebContents: () => new Map(),
    nativeSelectionUnderWay: () => false,
    // The same step the zoom bar and Ctrl/Cmd with + or - take.
    zoom: (tabId, direction) => { setZoom({ getTab: () => tab, changed, getState: () => ({}) as BrowserState, zoomed: () => undefined }, { tabId, action: direction }) },
    ...overrides
  }
  attachPageWheelZoom(access, tab, webContents)
  const turn = (direction: 'in' | 'out') => { webContents.emit('zoom-changed', {}, direction) }
  return { tab, webContents, changed, turn, percent: () => Math.round(webContents.getZoomFactor() * 100) }
}

describe('Control with the mouse wheel', () => {
  it('zooms a website one step for each notch, as Ctrl/Cmd with + or - does', () => {
    // Electron reports the zoom Chromium asks for and leaves it to the app, so the page stayed at 100%.
    const { turn, percent, changed, tab } = attached('https://maps.example/')
    turn('in')
    expect(percent()).toBe(110)
    turn('in')
    expect(percent()).toBe(125)
    turn('out')
    turn('out')
    turn('out')
    expect(percent()).toBe(90)
    expect(changed).toHaveBeenCalledWith(false)
    expect(tab.nativeInputEnvironmentGeneration).toBe(5)
  })

  it('keeps Hronaut Home at its own size', () => {
    const { turn, percent } = attached('hronaut://home/')
    turn('in')
    expect(percent()).toBe(100)
  })

  it.each([
    ['behind trusted chrome', { browserContentOccluded: () => true }],
    ['while the tab is locked', { isHumanInteractionLocked: () => true }],
    ['while an agent sends input to the page', { agentInputWebContents: () => new Map([[41, 1]]) }],
    ['during an area capture or element pick on the page', { nativeSelectionUnderWay: (id: number) => id === 41 }],
    ['after the tab closed', { findTab: () => undefined }]
  ])('leaves the zoom alone %s', (_case, overrides: Partial<PageWheelZoomAccess<ZoomTab>>) => {
    const { turn, percent } = attached('https://maps.example/', overrides)
    turn('in')
    expect(percent()).toBe(100)
  })

  it('leaves the zoom alone for a page the tab no longer shows', () => {
    const { turn, percent, tab } = attached('https://maps.example/')
    tab.webContents = page()
    turn('in')
    expect(percent()).toBe(100)
    expect(tab.webContents.getZoomFactor()).toBe(1)
  })
})

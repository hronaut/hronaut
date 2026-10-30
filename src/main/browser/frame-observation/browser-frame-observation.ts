import { getTab } from '../browser-core.js'
import type { Browser } from '../browser.js'
import { FrameObservationController } from './frame-observation.js'

/**
 * Observes an embedded frame in the browser's active tabs through Hronaut's own DevTools session, only while no
 * other debugger use or a recording owns the page's debugger.
 */
export function createFrameObservation(browser: Browser): FrameObservationController {
  return new FrameObservationController({
    resolve: tabId => {
      const tab = getTab(browser, tabId)
      if (tab.sleeping || tab.pageLifecycleState !== 'active') throw new Error('Frame observation requires an already active tab')
      return { page: tab.webContents, identity: tab, workspace: tab.mcpGroupId ? browser.mcpTabGroups.get(tab.mcpGroupId) : undefined, generation: tab.navigationGeneration, observationGeneration: tab.observationGeneration, permissionGeneration: tab.mcpGroupId ? browser.inspectionPermissions.get(browser.mcpTabGroups.get(tab.mcpGroupId)!) ?? 0 : 0 }
    },
    run: (id, operation) => browser.debuggerQueue.run(id, operation),
    requireOwner: (tabId, page) => {
      const tab = getTab(browser, tabId)
      if (tab.webContents !== page || page.isDestroyed() || !page.debugger.isAttached() || !tab.networkDebuggerEnabled
        || browser.devToolsOpening.has(page.id) || page.isDevToolsOpened() || tab.codeCoverage?.recording
        || tab.cpuProfile?.recording || tab.memoryAllocation?.recording || tab.reproRecording?.active
        || browser.videoRecorder.state(tab.id).status === 'recording') throw new Error('Frame observation debugger unavailable')
    }
  })
}

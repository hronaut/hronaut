import { SplitDividerController } from '../split-divider-controller.js'
import type { Browser } from '../browser.js'
import { publishChange } from '../browser-state/browser-state.js'

/**
 * The split view divider's drag, which owns only the split it began on and
 * applies its ratio to the split view: a preview lays the pages out, a commit
 * also advances the split's generation and saves the state, and a cancel
 * restores the ratio and publishes it unsaved.
 */
export function createSplitDivider(browser: Browser): SplitDividerController {
  return new SplitDividerController({
    read: () => browser.getSplitDivider(),
    owns: (geometry) => browser.splitViewGeneration === geometry.revision
      && browser.splitView?.firstTabId === geometry.firstTabId
      && browser.splitView?.secondTabId === geometry.secondTabId
      && browser.splitView?.orientation === geometry.orientation,
    apply: (ratio, mode) => {
      if (!browser.splitView) return
      browser.splitView.ratio = ratio
      if (mode === 'commit') browser.splitViewGeneration += 1
      browser.layout()
      if (mode !== 'preview') publishChange(browser, mode === 'commit')
    }
  })
}

import { SplitDividerController } from '../split-divider-controller.js'
import type { SplitViewAccess, SplitViewTab } from './split-view-access.js'

/**
 * The split view divider's drag, which owns only the split it began on and
 * applies its ratio to the split view: a preview lays the pages out, a commit
 * also advances the split's generation and saves the state, and a cancel
 * restores the ratio and publishes it unsaved.
 */
export function createSplitDivider<Tab extends SplitViewTab>(access: SplitViewAccess<Tab>): SplitDividerController {
  return new SplitDividerController({
    read: () => access.getSplitDivider(),
    owns: (geometry) => access.splitViewGeneration() === geometry.revision
      && access.splitView()?.firstTabId === geometry.firstTabId
      && access.splitView()?.secondTabId === geometry.secondTabId
      && access.splitView()?.orientation === geometry.orientation,
    apply: (ratio, mode) => {
      if (!access.splitView()) return
      access.splitView()!.ratio = ratio
      if (mode === 'commit') access.writeSplitViewGeneration(access.splitViewGeneration() + 1)
      access.layout()
      if (mode !== 'preview') access.changed(mode === 'commit')
    }
  })
}

import type { HronautEmulationFrameApi } from '../../shared/emulation-frame.js'
import { EMULATION_FRAME_IPC, PAGE_CARD_IPC, SPLIT_DIVIDER_IPC } from '../../shared/ipc/page-geometry.js'
import type { HronautPageCardApi } from '../../shared/page-card.js'
import type { HronautSplitDividerApi } from '../../shared/split-view.js'
import { invoke, subscribe } from './ipc.js'

/** window.hronautSplitDivider: the divider between the two pages of a split view. */
export const splitDividerApi: HronautSplitDividerApi = {
  get: () => invoke(SPLIT_DIVIDER_IPC.get),
  begin: (revision) => invoke(SPLIT_DIVIDER_IPC.begin, revision),
  update: (token, ratio) => invoke(SPLIT_DIVIDER_IPC.update, token, ratio),
  finish: (token, commit, ratio) => invoke(SPLIT_DIVIDER_IPC.finish, token, commit, ratio),
  setRatio: (revision, ratio) => invoke(SPLIT_DIVIDER_IPC.setRatio, revision, ratio),
  onChanged: (listener) => subscribe(SPLIT_DIVIDER_IPC.changed, (geometry) => listener(geometry))
}

/** window.hronautEmulationFrame: the frames around pages that emulate a smaller viewport. */
export const emulationFrameApi: HronautEmulationFrameApi = {
  get: () => invoke(EMULATION_FRAME_IPC.get),
  onChanged: (listener) => subscribe(EMULATION_FRAME_IPC.changed, (frames) => listener(frames))
}

/** window.hronautPageCard: where each page in view sits, for the cards around them. */
export const pageCardApi: HronautPageCardApi = {
  get: () => invoke(PAGE_CARD_IPC.get),
  onChanged: (listener) => subscribe(PAGE_CARD_IPC.changed, (cards) => listener(cards))
}

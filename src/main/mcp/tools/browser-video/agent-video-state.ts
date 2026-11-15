import { isAbsolute, relative } from 'node:path'
import type { BrowserVideoState } from '../../../../shared/video.js'

/** A recording as browser_video reports it; its export may leave out where the person saved it. */
export type AgentVideoState = Omit<BrowserVideoState, 'exported'> & {
  exported?: Omit<NonNullable<BrowserVideoState['exported']>, 'path'> & { path?: string }
}

/**
 * The recording as an agent reads it. A video the person saved through the Save dialog, where the download folder could
 * not be written, keeps the folder they chose out of the result; one in the download folder keeps its path.
 */
export function agentVideoState(state: BrowserVideoState, downloadDirectory: string): AgentVideoState {
  const exported = state.exported
  if (!exported) return state
  const inside = relative(downloadDirectory, exported.path)
  if (inside && !inside.startsWith('..') && !isAbsolute(inside)) return state
  const { path: _chosen, ...rest } = exported
  return { ...state, exported: rest }
}

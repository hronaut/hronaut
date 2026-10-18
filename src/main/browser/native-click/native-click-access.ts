import type { WebContents } from 'electron'
import type { NativeInputDispatchObserver } from '../native-key-hold.js'

/**
 * What dispatching a native click needs from the tab manager: sending one
 * input command to the page under the agent's input authorization, which the
 * manager's agent input authorization keeps private.
 */
export interface NativeClickAccess {
  /**
   * Sends the debugger input command while the agent's input is authorized,
   * after validateInput and, for a raw press, beforeRawDispatch; the observer
   * learns when a raw command was attempted and acknowledged.
   */
  sendAuthorizedAgentInputCommand(
    webContents: WebContents,
    method: string,
    commandParams?: Record<string, unknown>,
    validateInput?: () => void,
    observer?: NativeInputDispatchObserver,
    beforeRawDispatch?: () => Promise<void>
  ): Promise<unknown>
}

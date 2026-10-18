import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { DownloadCopyProgress } from '../../../browser/download-copy/download-copy.js'
import { textResult } from '../../tool-results.js'
import type { WorkspaceToolCall } from '../tool-context.js'

const SEPARATE_GRANT_REQUIRED = {
  status: 'REFUSED',
  reason: 'SEPARATE_GRANT_REQUIRED',
  dispatch: 'not-dispatched',
  effects: 'none',
  nextAction: 'Copying downloads needs a capability credential whose profile lists the exact destination folders. Ask the person to create one in Settings → MCP security with the argument constraint browser_download_copy.directory set to each folder; full-access credentials cannot copy downloads.'
}

/** A copy whose outcome the agent has to check in the folder itself; it is never repeated automatically. */
function uncertainCopyResult(copied: boolean): CallToolResult {
  const outcome = copied
    ? {
        status: 'COPIED_UNCONFIRMED',
        reason: 'COPY_PUBLICATION_REVOKED',
        dispatch: 'dispatched',
        effects: 'file-written',
        retrySafe: false,
        nextAction: 'The copy was written to the destination folder under the requested name, but this call could not confirm it: its authority or workspace changed, or its record could not be saved. Check the folder before copying again; do not copy again automatically.'
      }
    : {
        status: 'COPY_OUTCOME_UNKNOWN',
        reason: 'PARTIAL_COPY_MAY_REMAIN',
        dispatch: 'dispatched',
        effects: 'possible',
        retrySafe: false,
        nextAction: 'The copy failed after its file was created, and Hronaut could not confirm that the file is gone, so part of a copy may remain under the requested name or wherever another program moved it. Check the folder before copying again; do not copy again automatically.'
      }
  return { ...textResult(outcome), structuredContent: outcome, isError: true }
}

/** A copy that left nothing behind, whose own result the call could not deliver because its authority or workspace changed. */
function notCopiedResult(dispatched: boolean): CallToolResult {
  const outcome = {
    status: 'NOT_COPIED',
    reason: 'COPY_CONTEXT_CHANGED',
    dispatch: dispatched ? 'dispatched' : 'not-dispatched',
    effects: 'none',
    retrySafe: false,
    nextAction: 'Nothing was copied: this call\'s authority or workspace changed before a copy was made, or the partial copy was removed. Obtain fresh state before copying again.'
  }
  return { ...textResult(outcome), structuredContent: outcome, isError: true }
}

/**
 * How a download copy settles. Only a capability credential reaches it, so the person names the destination
 * folders; full access is refused before anything else. Once a copy was written, or a partial one may remain,
 * every failure says so instead of the shared outcome-unknown result, so the agent checks the folder rather than
 * taking it for nothing having happened. When nothing remains, the copy's own refusal is reported as it is; if the
 * call's authority or workspace changed and its result was discarded, the agent is told that nothing was copied.
 * A copy is published only if the call still has its authority then. These hooks run after the handler returned, so
 * the progress they read is final.
 */
export function downloadCopySettlement(hasCapability: boolean) {
  const progress: DownloadCopyProgress & { copied: boolean } = { created: false, removed: false, copied: false }
  // The status of the handler's own result, once it returned, to tell it from the shared result that replaces a
  // discarded one. A rejection before the handler ran is reported as it is.
  let dispatched: { status: unknown } | undefined
  let admitted: WorkspaceToolCall<unknown> | undefined
  const uncertain = (): CallToolResult | undefined => progress.copied
    ? uncertainCopyResult(true)
    : progress.created && !progress.removed ? uncertainCopyResult(false) : undefined
  return {
    progress,
    admit: (): CallToolResult | undefined => hasCapability
      ? undefined
      : { ...textResult(SEPARATE_GRANT_REQUIRED), structuredContent: SEPARATE_GRANT_REQUIRED, isError: true },
    prepare: (call: WorkspaceToolCall<unknown>): void => { admitted = call },
    effectsPossible: (): boolean => uncertain() !== undefined,
    afterDispatch: (result: CallToolResult): void => { dispatched = { status: result.structuredContent?.status } },
    publicationRevoked: (): CallToolResult => uncertain() ?? notCopiedResult(dispatched !== undefined),
    settleDenied: (): CallToolResult => uncertain() ?? notCopiedResult(dispatched !== undefined),
    publish: (result: CallToolResult): CallToolResult | undefined => {
      if (result.isError) return uncertain() ?? (dispatched && result.structuredContent?.status !== dispatched.status ? notCopiedResult(true) : undefined)
      // The audit outcome is saved after the shared checks, so the call's authority is checked once more, with no
      // await before the result is returned: an agent whose access was withdrawn is not told where the copy went.
      try {
        if (!admitted || admitted.signal?.aborted) throw new Error('Download copy publication guard is unavailable')
        admitted.requireCurrentTarget()
      } catch {
        return uncertainCopyResult(true)
      }
      return undefined
    },
    settleError: (): CallToolResult | undefined => uncertain()
  }
}

export type DownloadCopySettlement = ReturnType<typeof downloadCopySettlement>

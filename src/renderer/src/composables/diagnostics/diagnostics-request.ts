import type { Ref } from 'vue'
import type { BrowserDomChangesAction, BrowserTabState } from '../../../../shared/types.js'

/**
 * A diagnostics request as useDiagnosticsController began it: a copy of the
 * page context, the controller generation and the panel's request sequence.
 * A panel applies a late result only while `current` still accepts the
 * request, so a page change or a newer request for the same panel wins.
 */
export interface DiagnosticsRequest {
  tab: BrowserTabState
  generation: number
  sequence: number
}

/** The request lifetime a report panel receives from the controller. */
export interface DiagnosticsRequests<Domain extends string> {
  begin: (domain: Domain) => DiagnosticsRequest | null
  current: (domain: Domain, request: DiagnosticsRequest) => boolean
}

/**
 * The request lifetime a recorder panel receives from the controller. A
 * background `get` yields to an in-flight user action on the same page until
 * that action calls finishRecorderRequest.
 */
export interface DiagnosticsRecorderRequests<Domain extends string> {
  beginRecorderRequest: (domain: Domain, action: BrowserDomChangesAction | 'checkpoint') => DiagnosticsRequest | null
  finishRecorderRequest: (domain: Domain, request: DiagnosticsRequest) => void
  current: (domain: Domain, request: DiagnosticsRequest) => boolean
}

/** Copies text and shows copied feedback only while the panel still owns it. */
export interface DiagnosticsCopyFeedback<Key extends string> {
  copyWithFeedback: (key: Key, payload: string, copied: Ref<boolean>) => Promise<void>
}

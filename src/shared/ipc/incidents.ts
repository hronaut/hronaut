import type { IncidentCaptureInput, IncidentDraft, IncidentPreview, IncidentReviewInput } from '../incident-package.js'
import type { InvokeChannel } from './channel.js'

/** Incident packages: a capture of a tab's problem, reviewed by the person before it is saved as a file. Each shell has its own draft. */
export const INCIDENT_IPC = {
  /** Shell → main: captures the tab's last minutes of evidence of these kinds as a new draft, replacing the shell's last one. */
  capture: 'browser:incident-capture' as InvokeChannel<[input: IncidentCaptureInput], IncidentDraft>,
  /** Shell → main: the draft as it would be saved, with what the person chose to include, leave out and replace. */
  review: 'browser:incident-review' as InvokeChannel<[input: IncidentReviewInput], IncidentPreview>,
  /** Shell → main: retires the draft's last preview, so nothing is saved until it is reviewed again. */
  invalidatePreview: 'browser:incident-invalidate-preview' as InvokeChannel<[draftId: string], void>,
  /** Shell → main: forgets the shell's draft. */
  discard: 'browser:incident-discard' as InvokeChannel<[], void>,
  /** Shell → main: saves the reviewed preview to a file the person picks; saved is false when they picked none. */
  save: 'browser:incident-save' as InvokeChannel<[input: { draftId: string; previewId: string; reviewed: true }], { saved: boolean; sha256?: string; bytes?: number }>
} as const

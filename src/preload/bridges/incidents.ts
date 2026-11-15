import { INCIDENTS_IPC } from '../../shared/ipc/incidents.js'
import type { HronautIncidentsApi } from '../../shared/types.js'
import { invoke } from './ipc.js'

/** window.hronaut's incident packages. */
export const incidentsApi: HronautIncidentsApi = {
  captureIncident: (input) => invoke(INCIDENTS_IPC.capture, input),
  reviewIncident: (input) => invoke(INCIDENTS_IPC.review, input),
  invalidateIncidentPreview: (draftId) => invoke(INCIDENTS_IPC.invalidatePreview, draftId),
  discardIncident: () => invoke(INCIDENTS_IPC.discard),
  saveIncident: (input) => invoke(INCIDENTS_IPC.save, input)
}

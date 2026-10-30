import { INCIDENT_IPC } from '../../shared/ipc/incidents.js'
import type { HronautIncidentsApi } from '../../shared/types.js'
import { invoke } from './ipc.js'

/** window.hronaut's incident packages. */
export const incidentsApi: HronautIncidentsApi = {
  captureIncident: (input) => invoke(INCIDENT_IPC.capture, input),
  reviewIncident: (input) => invoke(INCIDENT_IPC.review, input),
  invalidateIncidentPreview: (draftId) => invoke(INCIDENT_IPC.invalidatePreview, draftId),
  discardIncident: () => invoke(INCIDENT_IPC.discard),
  saveIncident: (input) => invoke(INCIDENT_IPC.save, input)
}

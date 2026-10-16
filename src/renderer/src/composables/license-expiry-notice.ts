import type { CommercialLicenseState } from '../../../shared/types.js'

/** The renewal notice under the toolbar shows once access has ended after a trial or a paid grant. */
export function licenseExpiryNoticeShown(state: CommercialLicenseState): boolean {
  return state.accessAllowed === false && (state.trialStatus === 'expired' || state.status !== 'not-activated')
}

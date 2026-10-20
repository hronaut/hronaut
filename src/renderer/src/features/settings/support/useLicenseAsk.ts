import { computed, ref, watch, type Ref } from 'vue'
import type { CommercialLicenseState } from '../../../../../shared/types.js'

/** Why the license card under the toolbar asks for a license: a trial or a paid license has ended. */
export type LicenseAskReason = 'trial-ended' | 'license-ended'

/** Agent automation has ended after a trial or a paid license; during a trial Hronaut asks for nothing. */
export function licenseAskReason(state: CommercialLicenseState): LicenseAskReason | null {
  if (state.accessAllowed !== false) return null
  if (state.status !== 'not-activated') return 'license-ended'
  return state.trialStatus === 'expired' ? 'trial-ended' : null
}

/**
 * The license ask once agent access has ended: a card under the toolbar at launch, and after "Not now" a red
 * "License needed" reminder in the top bar instead. The card comes back when the app starts again or the reason
 * changes, such as a renewed license that later ends.
 */
export function useLicenseAsk(state: Readonly<Ref<CommercialLicenseState>>) {
  const reason = computed(() => licenseAskReason(state.value))
  const dismissed = ref(false)
  // Synchronous, so a Not now that lands before the next render is not undone by the change that showed the card.
  watch(reason, () => { dismissed.value = false }, { flush: 'sync' })
  const cardReason = computed(() => dismissed.value ? null : reason.value)
  const reminderShown = computed(() => reason.value !== null && cardReason.value === null)

  return {
    cardReason,
    reminderShown,
    dismiss: () => { dismissed.value = true }
  }
}

export type LicenseAskController = ReturnType<typeof useLicenseAsk>

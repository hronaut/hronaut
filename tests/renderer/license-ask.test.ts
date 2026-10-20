import { effectScope, nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { licenseAskReason, useLicenseAsk } from '../../src/renderer/src/features/settings/support/useLicenseAsk.js'
import type { CommercialLicenseState } from '../../src/shared/types.js'

const trial: CommercialLicenseState = {
  status: 'not-activated', active: false, secureStorageAvailable: true, accessAllowed: true,
  trialStatus: 'active', trialExpiresAt: '2026-10-21T00:00:00.000Z'
}
const trialEnded: CommercialLicenseState = { ...trial, accessAllowed: false, trialStatus: 'expired' }
const licensed: CommercialLicenseState = { ...trial, status: 'active', active: true, maskedKey: '••••-TEST' }

describe('licenseAskReason', () => {
  it('asks nothing before, during or without a started trial, nor with an active license', () => {
    expect(licenseAskReason({ ...trial, trialStatus: 'not-started', trialExpiresAt: undefined })).toBeNull()
    expect(licenseAskReason(trial)).toBeNull()
    expect(licenseAskReason(licensed)).toBeNull()
    // The renderer's placeholder before main sends the state.
    expect(licenseAskReason({ status: 'not-activated', active: false, secureStorageAvailable: false })).toBeNull()
  })

  it('asks once access has ended after a trial or a paid license', () => {
    expect(licenseAskReason(trialEnded)).toBe('trial-ended')
    expect(licenseAskReason({ ...licensed, status: 'expired', active: false, accessAllowed: false })).toBe('license-ended')
    // A paid grant that ended without a trial started still asks.
    expect(licenseAskReason({ status: 'expired', active: false, secureStorageAvailable: true, accessAllowed: false, trialStatus: 'not-started' })).toBe('license-ended')
  })
})

describe('useLicenseAsk', () => {
  it('shows the card until Not now, then the red reminder, and asks again when the reason changes', async () => {
    const scope = effectScope()
    const state = ref<CommercialLicenseState>(trial)
    const ask = scope.run(() => useLicenseAsk(state))!
    expect(ask.cardReason.value).toBeNull()
    expect(ask.reminderShown.value).toBe(false)

    state.value = trialEnded
    expect(ask.cardReason.value).toBe('trial-ended')
    expect(ask.reminderShown.value).toBe(false)

    ask.dismiss()
    expect(ask.cardReason.value).toBeNull()
    expect(ask.reminderShown.value).toBe(true)

    // A new state with the same reason keeps the card closed.
    state.value = { ...trialEnded }
    await nextTick()
    expect(ask.cardReason.value).toBeNull()

    state.value = licensed
    await nextTick()
    expect(ask.cardReason.value).toBeNull()
    expect(ask.reminderShown.value).toBe(false)

    state.value = { ...licensed, status: 'expired', active: false, accessAllowed: false }
    await nextTick()
    expect(ask.cardReason.value).toBe('license-ended')
    expect(ask.reminderShown.value).toBe(false)
    scope.stop()
  })
})

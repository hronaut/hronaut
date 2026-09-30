import { cleanup, fireEvent, render, screen } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import LicenseExpiryNotice from '../../src/renderer/src/components/LicenseExpiryNotice.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { CommercialLicenseState } from '../../src/shared/types.js'

afterEach(cleanup)
it('shows a nonmodal renewal route only after access ends, and removes it on renewal', async () => {
  const state: CommercialLicenseState = { status: 'not-activated', active: false, secureStorageAvailable: false, accessAllowed: false, trialStatus: 'not-started' }
  const onManage = vi.fn()
  const onPurchase = vi.fn()
  const view = render(LicenseExpiryNotice, { props: { state, onManage, onPurchase }, global: { plugins: [createHronautI18n('en-US')] } })
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  await view.rerender({ state: { ...state, trialStatus: 'expired' } })
  expect(screen.getByRole('status')).toHaveTextContent('Saved data remains available')
  expect(onPurchase).not.toHaveBeenCalled()
  await fireEvent.click(screen.getByRole('button', { name: 'License settings' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Buy or renew ↗' }))
  expect(onManage).toHaveBeenCalledOnce()
  expect(onPurchase).toHaveBeenCalledOnce()
  await view.rerender({ state: { ...state, active: true, accessAllowed: true, status: 'active' } })
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('offers refresh or renewal when a paid grant ends even without a started trial', () => {
  render(LicenseExpiryNotice, { props: { state: { status: 'expired', active: false, secureStorageAvailable: true, accessAllowed: false, trialStatus: 'not-started' } }, global: { plugins: [createHronautI18n('en-US')] } })
  expect(screen.getByRole('status')).toBeVisible()
})

import { cleanup, fireEvent, render, screen } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import LicenseAskCard from '../../src/renderer/src/components/LicenseAskCard.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'

afterEach(cleanup)
it('asks for a license after the trial with the price, buy, key and Not now actions', async () => {
  const onManage = vi.fn()
  const onPurchase = vi.fn()
  const onDismiss = vi.fn()
  const view = render(LicenseAskCard, { props: { reason: null, onManage, onPurchase, onDismiss }, global: { plugins: [createHronautI18n('en-US')] } })
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  await view.rerender({ reason: 'trial-ended' })
  const card = screen.getByRole('status', { name: 'Keep your agents working' })
  expect(card).toHaveTextContent('Your 10-day trial has ended')
  expect(card).toHaveTextContent('Your workspaces, sign-ins and saved data are all still here.')
  expect(card).toHaveTextContent('$4/month or $24/year per user')
  expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
    'A separate workspace and sign-ins for every project',
    'Your everyday browser stays out of it',
    'Pause and take over at any time'
  ])
  await fireEvent.click(screen.getByRole('button', { name: 'Buy license ↗' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Enter license key' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
  expect(onPurchase).toHaveBeenCalledOnce()
  expect(onManage).toHaveBeenCalledOnce()
  expect(onDismiss).toHaveBeenCalledOnce()
})

it('offers License settings when a paid license has ended', () => {
  render(LicenseAskCard, { props: { reason: 'license-ended' }, global: { plugins: [createHronautI18n('en-US')] } })
  expect(screen.getByRole('status')).toHaveTextContent('Your license is no longer active')
  expect(screen.getByRole('button', { name: 'License settings' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Enter license key' })).not.toBeInTheDocument()
})

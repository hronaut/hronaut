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
  expect(screen.queryByRole('region')).not.toBeInTheDocument()
  // The announcement is in the page before access ends, so that screen readers read it when it changes.
  const announcement = screen.getByRole('status')
  expect(announcement).toBeEmptyDOMElement()
  await view.rerender({ reason: 'trial-ended' })
  expect(announcement).toHaveTextContent('Your 10-day trial has ended')
  const card = screen.getByRole('region', { name: 'Keep your agents working' })
  expect(card).toHaveTextContent('Your 10-day trial has ended')
  expect(card).toHaveTextContent('Your workspaces, sign-ins and saved data are all still here.')
  expect(card).toHaveTextContent('$4/month or $24/year per user')
  expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
    'Agents get their own workspace and sign-ins for every project',
    'Agents stay out of your everyday browser',
    'Pause an agent and take over at any time'
  ])
  expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Buy license ↗', 'Enter license key', 'Not now'])
  await fireEvent.click(screen.getByRole('button', { name: 'Buy license ↗' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Enter license key' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
  expect(onPurchase).toHaveBeenCalledOnce()
  expect(onManage).toHaveBeenCalledOnce()
  expect(onDismiss).toHaveBeenCalledOnce()
})

it('puts License settings first when a paid license has ended', () => {
  render(LicenseAskCard, { props: { reason: 'license-ended' }, global: { plugins: [createHronautI18n('en-US')] } })
  expect(screen.getByRole('region', { name: 'Keep your agents working' })).toHaveTextContent('check it again in License settings if you\'ve been offline')
  // A subscriber offline for a week saw Buy license first and could pay twice.
  const buttons = screen.getAllByRole('button')
  expect(buttons.map((button) => button.textContent)).toEqual(['License settings', 'Buy license ↗', 'Not now'])
  expect(buttons[0]).toHaveClass('ui-button--primary')
  expect(screen.queryByRole('button', { name: 'Enter license key' })).not.toBeInTheDocument()
})

it('keeps a held Enter from pressing the card\'s buttons again', () => {
  render(LicenseAskCard, { props: { reason: 'trial-ended' }, global: { plugins: [createHronautI18n('en-US')] } })
  for (const button of screen.getAllByRole('button')) {
    const repeat = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })
    button.dispatchEvent(repeat)
    // Holding Enter on Buy license opened the pricing page once for every repeat.
    expect(repeat.defaultPrevented, button.textContent ?? '').toBe(true)
  }
})

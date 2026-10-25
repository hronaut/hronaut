import { createTestingPinia } from '@pinia/testing'
import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SecureDnsSettings from '../../src/renderer/src/components/SecureDnsSettings.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import { SECURE_DNS_PROVIDERS, type SecureDnsMode } from '../../src/shared/secure-dns.js'
import type { AppSettings } from '../../src/shared/types.js'

// Settings had no secure DNS: Chromium's Automatic mode ran with no way to turn it off or choose a provider. As in
// Chrome's Use secure DNS, a switch turns it on or off, and a list picks the DNS service's own or one provider.

const CLOUDFLARE = SECURE_DNS_PROVIDERS[0].template
const GOOGLE = SECURE_DNS_PROVIDERS[1].template

function renderSettings(saved: Partial<AppSettings> = {}) {
  let settings: AppSettings = { ...DEFAULT_RENDERER_SETTINGS, ...saved }
  const setSecureDns = vi.fn(async (secureDnsMode: SecureDnsMode, secureDnsTemplate: string) => {
    settings = { ...settings, secureDnsMode, secureDnsTemplate }
    return settings
  })
  Object.defineProperty(window, 'hronautSettings', { configurable: true, value: { setSecureDns } })
  const pinia = createTestingPinia({
    stubActions: false,
    createSpy: vi.fn,
    initialState: { settings: { settings, systemTheme: 'light', systemLocale: 'en-US', resolvedLocale: 'en-US' } }
  })
  const view = render(SecureDnsSettings, { global: { plugins: [pinia, createHronautI18n('en-US')] } })
  const region = screen.getByRole('region', { name: 'Secure DNS' })
  return { ...view, region, setSecureDns, user: userEvent.setup() }
}

describe('Secure DNS settings', () => {
  it('starts with the DNS service\'s own secure DNS, and turns it off and on', async () => {
    const { region, user, setSecureDns } = renderSettings()
    const use = within(region).getByRole('checkbox', { name: /Use secure DNS/ })
    const provider = within(region).getByRole('combobox', { name: /Provider/ })
    expect(use).toBeChecked()
    expect(provider).toHaveValue('automatic')
    expect(provider).toHaveDisplayValue('Your current DNS service')
    expect(within(region).getByText(/when your DNS service offers it/)).toBeVisible()
    await user.click(use)
    expect(setSecureDns).toHaveBeenLastCalledWith('off', '')
    expect(use).not.toBeChecked()
    expect(within(region).queryByRole('combobox')).toBeNull()
    await user.click(use)
    expect(setSecureDns).toHaveBeenLastCalledWith('automatic', '')
    expect(within(region).getByRole('combobox', { name: /Provider/ })).toHaveValue('automatic')
  })

  it('sends every lookup to a chosen provider, and goes back to the DNS service\'s own', async () => {
    const { region, user, setSecureDns } = renderSettings()
    const provider = within(region).getByRole('combobox', { name: /Provider/ })
    expect(within(provider).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Your current DNS service', 'Cloudflare (1.1.1.1)', 'Google (Public DNS)', 'Quad9 (9.9.9.9)', 'Custom'])
    await user.selectOptions(provider, 'Google (Public DNS)')
    expect(setSecureDns).toHaveBeenLastCalledWith('secure', GOOGLE)
    expect(provider).toHaveValue('google')
    expect(within(region).getByText(/through this provider only/)).toBeVisible()
    // Back on the DNS service's own, the chosen provider is kept for later.
    await user.selectOptions(provider, 'Your current DNS service')
    expect(setSecureDns).toHaveBeenLastCalledWith('automatic', GOOGLE)
    expect(within(region).queryByLabelText('Provider address')).toBeNull()
  })

  it('uses a custom provider only once its address is a valid one', async () => {
    const { region, user, setSecureDns } = renderSettings({ secureDnsMode: 'secure', secureDnsTemplate: CLOUDFLARE })
    const provider = within(region).getByRole('combobox', { name: /Provider/ })
    expect(provider).toHaveValue('cloudflare')
    await user.selectOptions(provider, 'Custom')
    const address = within(region).getByLabelText('Provider address')
    // The keyboard stays on the list, whose arrow keys go on changing the choice.
    expect(provider).toHaveFocus()
    expect(address).toHaveValue('')
    expect(address).toHaveAccessibleDescription('Addresses are looked up as before until you press Use.')
    expect(setSecureDns).not.toHaveBeenCalled()
    await user.type(address, 'http://dns.example/dns-query{Enter}')
    expect(address).toHaveAccessibleDescription('Enter a valid https:// address')
    expect(address).toHaveAttribute('aria-invalid', 'true')
    expect(setSecureDns).not.toHaveBeenCalled()
    await user.clear(address)
    await user.type(address, ' https://dns.example/dns-query ')
    await user.click(within(region).getByRole('button', { name: 'Use' }))
    expect(setSecureDns).toHaveBeenLastCalledWith('secure', 'https://dns.example/dns-query')
    expect(provider).toHaveValue('custom')
    expect(address).toHaveValue('https://dns.example/dns-query')
    expect(address).toHaveAccessibleDescription('An https:// address, such as https://dns.example/dns-query')
    // Picked again after a listed provider, Custom has the address used last.
    await user.selectOptions(provider, 'Cloudflare (1.1.1.1)')
    expect(setSecureDns).toHaveBeenLastCalledWith('secure', CLOUDFLARE)
    expect(within(region).queryByLabelText('Provider address')).toBeNull()
    await user.selectOptions(provider, 'Custom')
    expect(within(region).getByLabelText('Provider address')).toHaveValue('https://dns.example/dns-query')
  })

  it('keeps an address typed while another is saved, with its own check', async () => {
    const { region, user, setSecureDns } = renderSettings({ secureDnsMode: 'secure', secureDnsTemplate: CLOUDFLARE })
    let finish!: () => void
    setSecureDns.mockImplementationOnce((secureDnsMode, secureDnsTemplate) => new Promise((resolve) => {
      finish = () => resolve({ ...DEFAULT_RENDERER_SETTINGS, secureDnsMode, secureDnsTemplate })
    }))
    await user.selectOptions(within(region).getByRole('combobox', { name: /Provider/ }), 'Custom')
    const address = within(region).getByLabelText('Provider address')
    await user.type(address, 'https://first.example/dns-query{Enter}')
    expect(setSecureDns).toHaveBeenLastCalledWith('secure', 'https://first.example/dns-query')
    await user.clear(address)
    await user.type(address, 'http://second.example/{Enter}')
    expect(address).toHaveAccessibleDescription('Enter a valid https:// address')
    finish()
    // Every step after the first save runs before the next task.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(setSecureDns).toHaveBeenCalledOnce()
    expect(address).toHaveValue('http://second.example/')
    expect(address).toHaveAccessibleDescription('Enter a valid https:// address')
  })

  it('shows a saved custom provider, says when the field holds another, and uses it once for a held Enter', async () => {
    const { region, user } = renderSettings({ secureDnsMode: 'secure', secureDnsTemplate: 'https://dns.example/q{?dns}' })
    expect(within(region).getByRole('combobox', { name: /Provider/ })).toHaveValue('custom')
    const address = within(region).getByLabelText('Provider address')
    expect(address).toHaveValue('https://dns.example/q{?dns}')
    expect(address).toHaveAccessibleDescription('An https:// address, such as https://dns.example/dns-query')
    await user.type(address, 'x')
    expect(address).toHaveAccessibleDescription('Addresses are looked up as before until you press Use.')
    const held = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })
    address.dispatchEvent(held)
    expect(held.defaultPrevented).toBe(true)
  })

  it('shows the saved setting again when a change fails', async () => {
    const view = renderSettings()
    const { region, user, setSecureDns } = view
    setSecureDns.mockRejectedValueOnce(new Error('disk full'))
    const use = within(region).getByRole('checkbox', { name: /Use secure DNS/ })
    await user.click(use)
    await vi.waitFor(() => expect(use).toBeChecked())
    setSecureDns.mockRejectedValueOnce(new Error('disk full'))
    const provider = within(region).getByRole('combobox', { name: /Provider/ })
    await user.selectOptions(provider, 'Quad9 (9.9.9.9)')
    await vi.waitFor(() => expect(provider).toHaveValue('automatic'))
    expect(view.emitted().settingError).toHaveLength(2)
  })
})

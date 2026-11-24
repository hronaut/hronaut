import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import PersonNeededWebhookSettings from '../../src/renderer/src/features/settings/PersonNeededWebhookSettings.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { PersonNeededWebhookConfig, PersonNeededWebhookSettings as Settings, PersonNeededWebhookTest } from '../../src/shared/types.js'

// Settings' Message me elsewhere: off until the person turns it on with an address, a test message says what came back,
// and the signing secret can be copied or renewed.

function renderSettings(saved: Partial<Settings> = {}, tests: PersonNeededWebhookTest[] = []) {
  let settings: Settings = { enabled: false, kind: 'json', url: '', secret: 'a'.repeat(43), ...saved }
  const setPersonNeededWebhook = vi.fn(async (config: PersonNeededWebhookConfig) => {
    settings = { ...settings, ...config }
    return settings
  })
  const testPersonNeededWebhook = vi.fn(async () => tests.shift() ?? { ok: true as const, status: 200 })
  const renewPersonNeededWebhookSecret = vi.fn(async () => {
    settings = { ...settings, secret: 'b'.repeat(43) }
    return settings
  })
  const copyText = vi.fn(async () => undefined)
  Object.defineProperty(window, 'hronautSettings', {
    configurable: true,
    value: { getPersonNeededWebhook: async () => settings, setPersonNeededWebhook, testPersonNeededWebhook, renewPersonNeededWebhookSecret }
  })
  Object.defineProperty(window, 'hronaut', { configurable: true, value: { copyText } })
  const view = render(PersonNeededWebhookSettings, { global: { plugins: [createHronautI18n('en-US')] } })
  return { ...view, setPersonNeededWebhook, testPersonNeededWebhook, renewPersonNeededWebhookSecret, copyText, user: userEvent.setup() }
}

describe('Message me elsewhere settings', () => {
  it('is off, says it sends data off the computer, and turns on only with an https address', async () => {
    const view = renderSettings()
    const { user, setPersonNeededWebhook } = view
    const toggle = screen.getByRole('checkbox', { name: /Message me elsewhere/ })
    await vi.waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).not.toBeChecked()
    expect(screen.getByText(/This sends data off this computer/)).toBeVisible()
    expect(screen.queryByRole('textbox', { name: /Webhook address/ })).toBeNull()

    await user.click(toggle)
    expect(setPersonNeededWebhook).not.toHaveBeenCalled()
    const kind = screen.getByRole('combobox', { name: 'Send to' })
    expect(Array.from(kind.querySelectorAll('option')).map((option) => option.textContent)).toEqual(['Slack', 'Discord', 'ntfy', 'Your own endpoint (JSON)'])
    const address = screen.getByRole('textbox', { name: /Webhook address/ })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Enter the address to send to.')).toBeVisible()
    await user.type(address, 'http://hooks.example/in')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText(/Use a full https:\/\/ address/)).toBeVisible()
    expect(setPersonNeededWebhook).not.toHaveBeenCalled()

    await user.selectOptions(kind, 'slack')
    await user.clear(address)
    await user.type(address, ' https://hooks.slack.example/services/T/B/x ')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(setPersonNeededWebhook).toHaveBeenLastCalledWith({ enabled: true, kind: 'slack', url: 'https://hooks.slack.example/services/T/B/x' })
    expect(toggle).toBeChecked()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.click(toggle)
    expect(setPersonNeededWebhook).toHaveBeenLastCalledWith({ enabled: false, kind: 'slack', url: 'https://hooks.slack.example/services/T/B/x' })
    expect(screen.queryByRole('textbox', { name: /Webhook address/ })).toBeNull()
    expect(view.emitted().settingError).toBeUndefined()
  })

  it('saves before a test, and says what the address answered', async () => {
    const { user, setPersonNeededWebhook, testPersonNeededWebhook } = renderSettings(
      { enabled: true, kind: 'ntfy', url: 'https://ntfy.example/topic' },
      [{ ok: false, reason: 'refused', status: 403 }, { ok: false, reason: 'unreachable' }, { ok: true, status: 200 }]
    )
    const address = await screen.findByRole('textbox', { name: /Webhook address/ })
    expect(address).toHaveValue('https://ntfy.example/topic')
    await user.click(screen.getByRole('button', { name: 'Send test' }))
    expect(setPersonNeededWebhook).not.toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent('The address answered with status 403.')
    await user.click(screen.getByRole('button', { name: 'Send test' }))
    expect(await screen.findByText('Could not reach the address.')).toBeVisible()

    await user.clear(address)
    await user.type(address, 'https://ntfy.example/other')
    await user.click(screen.getByRole('button', { name: 'Send test' }))
    expect(setPersonNeededWebhook).toHaveBeenLastCalledWith({ enabled: true, kind: 'ntfy', url: 'https://ntfy.example/other' })
    expect(await screen.findByText('Test message sent.')).toBeVisible()
    expect(testPersonNeededWebhook).toHaveBeenCalledTimes(3)
  })

  it('copies the signing secret and renews it', async () => {
    const { user, copyText, renewPersonNeededWebhookSecret } = renderSettings({ enabled: true, kind: 'json', url: 'https://hooks.example/in' })
    await user.click(await screen.findByRole('button', { name: 'Copy' }))
    expect(copyText).toHaveBeenCalledWith('a'.repeat(43))
    expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'New secret' }))
    expect(renewPersonNeededWebhookSecret).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(copyText).toHaveBeenLastCalledWith('b'.repeat(43))
  })
})

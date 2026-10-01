import { cleanup, render, screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import IncidentPackageReview from '../../src/renderer/src/components/IncidentPackageReview.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
const draft = { draftId: 'draft', expiresAt: 'later', artifacts: [{ kind: 'repro', status: 'available', truncated: false }] }
function setup() {
  const api = { captureIncident: vi.fn(async () => draft), reviewIncident: vi.fn(async () => ({ previewId: 'preview', html: '<p>Reviewed</p>', sha256: 'hash', bytes: 15 })), discardIncident: vi.fn(async () => undefined), saveIncident: vi.fn(async () => ({ saved: true })) }
  vi.stubGlobal('hronaut', api)
  const view = render(IncidentPackageReview, { props: { tabId: 'tab' }, global: { plugins: [createHronautI18n('en-US')] } })
  return { api, view, user: userEvent.setup() }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('requires selection, exact preview and explicit review; edits invalidate approval', async () => {
  const { api, user } = setup()
  await user.click(screen.getByText('Reviewed incident package'))
  expect(screen.getByRole('button', { name: 'Capture selected evidence' })).toBeDisabled()
  await user.click(screen.getByRole('checkbox', { name: 'Repro steps' }))
  await user.click(screen.getByRole('button', { name: 'Capture selected evidence' }))
  await user.click(await screen.findByRole('button', { name: 'Preview exact package' }))
  const save = await screen.findByRole('button', { name: 'Save reviewed HTML' })
  expect(save).toBeDisabled()
  expect(screen.getByTitle('Preview exact package')).toHaveAttribute('sandbox', '')
  await user.click(screen.getByRole('checkbox', { name: /I reviewed this package/ }))
  await user.click(save)
  expect(api.saveIncident).toHaveBeenCalledWith({ draftId: 'draft', previewId: 'preview', reviewed: true })
  await user.type(screen.getByLabelText('Exact text to replace (optional)'), 'private')
  expect(screen.queryByRole('button', { name: 'Save reviewed HTML' })).toBeNull()
})
it('discards and ignores a late capture when closed', async () => {
  const { api, user, view } = setup()
  let resolve!: (value: typeof draft) => void
  api.captureIncident.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  await user.click(screen.getByText('Reviewed incident package'))
  await user.click(screen.getByRole('checkbox', { name: 'Repro steps' }))
  await user.click(screen.getByRole('button', { name: 'Capture selected evidence' }))
  view.unmount()
  resolve(draft)
  await waitFor(() => expect(api.discardIncident).toHaveBeenCalled())
  expect(api.reviewIncident).not.toHaveBeenCalled()
})

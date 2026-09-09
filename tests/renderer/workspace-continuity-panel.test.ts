import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkspaceContinuityPanel from '../../src/renderer/src/components/WorkspaceContinuityPanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { WorkspaceContinuityReport } from '../../src/shared/workspace-continuity.js'

const suspended: WorkspaceContinuityReport = { status: 'BLOCKED', reasons: ['PRIOR_WRITE_OUTCOME_UNKNOWN'], priorOutcome: 'OUTCOME_UNKNOWN', priorOutcomeAcknowledged: false, suspended: true, checkpointId: 'checkpoint', reviewId: 'review', nextAction: 'INSPECT_AND_RECONCILE' }
const disposers: (() => void)[] = []
afterEach(() => disposers.splice(0).forEach(dispose => dispose()))
function setup() {
  const browser = {
    reviewWorkspaceContinuity: vi.fn(async (_id: string): Promise<WorkspaceContinuityReport> => ({ ...suspended })),
    checkpointWorkspaceContinuity: vi.fn(async (_id: string, _marker?: string): Promise<WorkspaceContinuityReport> => ({ ...suspended })),
    reconcileWorkspaceContinuity: vi.fn(async (_id: string, _review: string, _ack: boolean): Promise<WorkspaceContinuityReport> => ({ ...suspended, suspended: false, priorOutcomeAcknowledged: true }))
  }
  const wrapper = mount(WorkspaceContinuityPanel, { props: { workspaceId: 'first', browser }, global: { plugins: [createHronautI18n('en-US')] } })
  disposers.push(() => wrapper.unmount())
  const button = (label: string) => wrapper.findAll('button').find(item => item.text() === label)!
  return { wrapper, browser, button }
}

describe('human continuity review', () => {
  it('requires explicit acknowledgement and submits the exact reviewed identity', async () => {
    const { wrapper, browser, button } = setup(); await flushPromises()
    expect(button('Confirm reviewed state').attributes('disabled')).toBeDefined()
    expect(button('Create checkpoint').attributes('disabled')).toBeDefined()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await button('Confirm reviewed state').trigger('click'); await flushPromises()
    expect(browser.reconcileWorkspaceContinuity).toHaveBeenCalledExactlyOnceWith('first', 'review', true)
    expect(wrapper.text()).toContain('Earlier action outcome remains unknown')
    expect(wrapper.text()).toContain('Review guard cleared')
  })
  it('discards late reports when switching workspaces', async () => {
    const { wrapper, browser, button } = setup(); await flushPromises()
    let resolve!: (report: WorkspaceContinuityReport) => void
    browser.reviewWorkspaceContinuity.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    await button('Read current state').trigger('click')
    browser.reviewWorkspaceContinuity.mockResolvedValueOnce({ ...suspended, reasons: ['TAB_CHANGED'], reviewId: 'new-review' })
    await wrapper.setProps({ workspaceId: 'second' }); await flushPromises()
    resolve({ ...suspended }); await flushPromises()
    expect(wrapper.text()).toContain('Active tab changed')
    expect(wrapper.text()).not.toContain('Earlier action outcome remains unknown')
  })
  it('clears a rejected review and requires a new observation', async () => {
    const { wrapper, browser, button } = setup(); await flushPromises()
    browser.reconcileWorkspaceContinuity.mockRejectedValueOnce(new Error('Private stale details'))
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await button('Confirm reviewed state').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Read the current state again')
    expect(wrapper.text()).not.toContain('Private')
    expect(button('Confirm reviewed state').attributes('disabled')).toBeDefined()
  })
  it('passes an opt-in marker only when deliberately creating a checkpoint', async () => {
    const { wrapper, browser, button } = setup(); await flushPromises()
    browser.reviewWorkspaceContinuity.mockResolvedValueOnce({ ...suspended, checkpointId: null, reviewId: null })
    await button('Read current state').trigger('click'); await flushPromises()
    await wrapper.get('input[type="text"]').setValue('#account-marker')
    await button('Create checkpoint').trigger('click'); await flushPromises()
    expect(browser.checkpointWorkspaceContinuity).toHaveBeenCalledExactlyOnceWith('first', '#account-marker')
  })
})

import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import HumanWaitingPanel from '../../src/renderer/src/components/HumanWaitingPanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { HumanWaitingRecord } from '../../src/shared/human-waiting.js'

const record: HumanWaitingRecord = { id: 'decision', revision: 'revision', workspaceId: 'first', runId: 'run', decision: 'review-page', owner: 'Operator', fallbackOwner: 'Fallback', state: 'WAITING_FOR_HUMAN', createdAt: 1000, deadlineAt: 2000, notificationAttempts: 1, notificationStatus: 'delivered', nextAction: 'REVIEW_CURRENT_STATE', priorOutcome: 'OUTCOME_UNKNOWN' }
const dispose: (() => void)[] = []
afterEach(() => dispose.splice(0).forEach(fn => fn()))
function setup() {
  const browser = {
    listHumanWaiting: vi.fn(async (_id: string): Promise<HumanWaitingRecord[]> => [{ ...record }]),
    changeHumanWaiting: vi.fn(async (_workspace: string, _id: string, _revision: string, _action: string): Promise<HumanWaitingRecord> => ({ ...record, state: 'RESOLVED' }))
  }
  const view = mount(HumanWaitingPanel, { props: { workspaceId: 'first', browser }, global: { plugins: [createHronautI18n('en-US')] } })
  dispose.push(() => view.unmount())
  const button = (label: string) => view.findAll('button').find(item => item.text() === label)!
  return { view, browser, button }
}

it('requires explicit review and submits the exact decision revision', async () => {
  const { view, browser, button } = setup(); await flushPromises()
  expect(button('Complete review').attributes('disabled')).toBeDefined()
  await view.get('input[type="checkbox"]').setValue(true)
  await button('Complete review').trigger('click'); await flushPromises()
  expect(browser.changeHumanWaiting).toHaveBeenCalledExactlyOnceWith('first', 'decision', 'revision', 'resolve')
  expect(view.text()).toContain('Review completed')
  expect(view.text()).toContain('earlier action outcome remains unknown')
})

it('ignores a late decision list after switching workspaces', async () => {
  const { view, browser, button } = setup(); await flushPromises()
  let finish!: (records: HumanWaitingRecord[]) => void
  browser.listHumanWaiting.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await button('Refresh decisions').trigger('click')
  browser.listHumanWaiting.mockResolvedValueOnce([])
  await view.setProps({ workspaceId: 'second' }); await flushPromises()
  finish([{ ...record }]); await flushPromises()
  expect(view.text()).toContain('No human decisions')
  expect(view.text()).not.toContain('Operator')
})

it('hides private failure text and requires another explicit review after rejection', async () => {
  const { view, browser, button } = setup(); await flushPromises()
  browser.changeHumanWaiting.mockRejectedValueOnce(new Error('private page data'))
  await view.get('input[type="checkbox"]').setValue(true)
  await button('Complete review').trigger('click'); await flushPromises()
  expect(view.get('[role="alert"]').text()).toContain('Refresh and review')
  expect(view.text()).not.toContain('private page data')
  expect(button('Complete review').attributes('disabled')).toBeDefined()
})

it('loads current decisions when the workspace controls become available', async () => {
  const browser = { listHumanWaiting: vi.fn(async () => [{ ...record }]), changeHumanWaiting: vi.fn() }
  const view = mount(HumanWaitingPanel, { props: { workspaceId: 'first', disabled: true, browser }, global: { plugins: [createHronautI18n('en-US')] } })
  dispose.push(() => view.unmount())
  await flushPromises()
  expect(browser.listHumanWaiting).not.toHaveBeenCalled()
  await view.setProps({ disabled: false }); await flushPromises()
  expect(browser.listHumanWaiting).toHaveBeenCalledExactlyOnceWith('first')
  expect(view.text()).toContain('Operator')
})

it('shows a bounded exact-action receipt and offers cheap rejection', async () => {
  const reviewedRecord: HumanWaitingRecord = {
    ...record,
    decision: 'approve-action',
    review: {
      toolName: 'browser_click', actionClass: 'interact', reversibility: 'unknown',
      representation: 'bounded-description', description: 'Submit the visible form', expectedPostcondition: 'Confirmation appears',
      artifactHash: 'a'.repeat(64), sessionBinding: 'b'.repeat(64), workspaceName: 'Checkout QA', profileName: 'Restricted QA',
      origin: 'https://example.com', tabId: '0198dc5b-4192-7000-8000-000000000004', navigationGeneration: 3,
      humanInputGeneration: 1, browserSessionGeneration: 6,
      status: 'PROPOSED', receipts: [{ status: 'PROPOSED', at: 1000 }]
    }
  }
  const browser = {
    listHumanWaiting: vi.fn(async (): Promise<HumanWaitingRecord[]> => [reviewedRecord]),
    changeHumanWaiting: vi.fn(async (): Promise<HumanWaitingRecord> => ({ ...reviewedRecord, state: 'REJECTED' }))
  }
  const view = mount(HumanWaitingPanel, { props: { workspaceId: 'first', browser }, global: { plugins: [createHronautI18n('en-US')] } })
  dispose.push(() => view.unmount())
  await flushPromises()
  expect(view.text()).toContain('Submit the visible form')
  expect(view.text()).toContain('Checkout QA')
  expect(view.text()).toContain('Restricted QA')
  expect(view.text()).toContain('Authority generation')
  expect(view.text()).toContain('bbbbbbbbbbbb')
  expect(view.text()).toContain('Browser session generation')
  expect(view.text()).toContain('6')
  expect(view.text()).toContain('a'.repeat(64))
  const reject = view.findAll('button').find(item => item.text() === 'Reject action')!
  await reject.trigger('click'); await flushPromises()
  expect(browser.changeHumanWaiting).toHaveBeenCalledExactlyOnceWith('first', 'decision', 'revision', 'reject')
})

it('requires a separate signed-in account and target confirmation for a tab-bound browser approval', async () => {
  const reviewedRecord: HumanWaitingRecord = {
    ...record,
    decision: 'approve-action',
    review: {
      toolName: 'browser_click', actionClass: 'interact', reversibility: 'unknown',
      representation: 'bounded-description', description: 'Submit the visible form',
      artifactHash: 'a'.repeat(64), sessionBinding: 'b'.repeat(64), workspaceName: 'Checkout QA', profileName: 'Restricted QA',
      origin: 'https://example.com', tabId: '0198dc5b-4192-7000-8000-000000000004', browserSessionGeneration: 6,
      status: 'PROPOSED', receipts: [{ status: 'PROPOSED', at: 1000 }]
    }
  }
  const browser = {
    listHumanWaiting: vi.fn(async (): Promise<HumanWaitingRecord[]> => [reviewedRecord]),
    changeHumanWaiting: vi.fn(async (): Promise<HumanWaitingRecord> => ({ ...reviewedRecord, state: 'RESOLVED' }))
  }
  const view = mount(HumanWaitingPanel, { props: { workspaceId: 'first', browser }, global: { plugins: [createHronautI18n('en-US')] } })
  dispose.push(() => view.unmount())
  await flushPromises()
  const approve = view.findAll('button').find(item => item.text() === 'Approve exact action')!
  const confirmations = view.findAll('input[type="checkbox"]')
  expect(confirmations).toHaveLength(2)
  await confirmations[0].setValue(true)
  expect(approve.attributes('disabled')).toBeDefined()
  await confirmations[1].setValue(true)
  await approve.trigger('click'); await flushPromises()
  expect(browser.changeHumanWaiting).toHaveBeenCalledExactlyOnceWith(
    'first', 'decision', 'revision', 'resolve', { accountAndTargetVerified: true }
  )
})

it('shows every step in an ordered review group before approval', async () => {
  const firstStep = {
    toolName: 'browser_click', actionClass: 'interact' as const, reversibility: 'unknown' as const,
    representation: 'bounded-description' as const, description: 'Open the confirmation',
    expectedPostcondition: 'Confirmation is visible', artifactHash: 'a'.repeat(64), origin: 'https://example.com'
  }
  const secondStep = {
    ...firstStep, description: 'Confirm the operation', expectedPostcondition: 'Success is visible', artifactHash: 'c'.repeat(64)
  }
  const grouped: HumanWaitingRecord = {
    ...record, decision: 'approve-action', review: {
      ...firstStep, sessionBinding: 'b'.repeat(64), workspaceName: 'Grouped QA', profileName: 'Restricted QA',
      steps: [firstStep, secondStep], currentStep: 0, status: 'PROPOSED', receipts: [{ status: 'PROPOSED', at: 1000 }]
    }
  }
  const browser = {
    listHumanWaiting: vi.fn(async (): Promise<HumanWaitingRecord[]> => [grouped]),
    changeHumanWaiting: vi.fn(async (): Promise<HumanWaitingRecord> => ({ ...grouped, state: 'RESOLVED' }))
  }
  const view = mount(HumanWaitingPanel, { props: { workspaceId: 'first', browser }, global: { plugins: [createHronautI18n('en-US')] } })
  dispose.push(() => view.unmount())
  await flushPromises()
  expect(view.text()).toContain('Step 1 of 2 · browser_click')
  expect(view.text()).toContain('Step 2 of 2 · browser_click')
  expect(view.text()).toContain('Open the confirmation')
  expect(view.text()).toContain('Confirm the operation')
  expect(view.text()).toContain('I reviewed every action in this exact ordered group')
  expect(view.findAll('button').find(item => item.text() === 'Approve exact group')).toBeDefined()
})

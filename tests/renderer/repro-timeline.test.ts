import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import ReproTimeline from '../../src/renderer/src/components/ReproTimeline.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserReproRecording, BrowserReproStep } from '../../src/shared/types.js'

const global = { plugins: [createHronautI18n('en-US')] }

describe('recorded selectors for checkpoint drafts', () => {
  const active = () => ({ ...recording('2026-10-09T11:00:00Z', [step(1), step(2)]), active: true, checkpointContext: 'current-context' })

  it('fills only the selector and requires fresh review even when reusing the same selector', async () => {
    const view = render(ReproTimeline, { global, props: { locale: 'en-US', recording: active() } })
    const user = userEvent.setup()
    const selector = screen.getByLabelText('Selector', { selector: 'input' })
    const add = screen.getByRole('button', { name: 'Add checkpoint' })
    await user.selectOptions(screen.getByLabelText('Condition'), 'text')
    await user.type(screen.getByLabelText('Exact text', { selector: 'input' }), 'Intended result')
    await user.click(screen.getByRole('button', { name: 'Use selector for checkpoint' }))
    expect(selector).toHaveValue(step(1).target!.selector)
    expect(screen.getByLabelText('Condition')).toHaveValue('text')
    expect(screen.getByLabelText('Exact text', { selector: 'input' })).toHaveValue('Intended result')
    expect(add).toBeDisabled()
    expect(view.emitted('checkpoint')).toBeUndefined()
    await user.click(screen.getByRole('checkbox'))
    expect(add).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Use selector for checkpoint' }))
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(add).toBeDisabled()
    await user.click(within(screen.getByRole('listbox', { name: 'Recorded reproduction steps' })).getAllByRole('option')[1])
    await user.click(screen.getByRole('button', { name: 'Use selector for checkpoint' }))
    expect(selector).toHaveValue(step(2).target!.selector)
    await user.click(screen.getByRole('checkbox'))
    await user.click(add)
    expect(view.emitted('checkpoint')?.[0]).toEqual([{ context: 'current-context', selector: step(2).target!.selector, condition: 'text', text: 'Intended result', reviewed: true }])
  })

  it.each(['stopped', 'missing-context', 'busy', 'missing-selector', 'oversized-selector'] as const)('does not offer reuse for %s', async state => {
    const data = active()
    if (state === 'stopped') data.active = false
    if (state === 'missing-context') data.checkpointContext = ''
    if (state === 'missing-selector') data.steps[0].target!.selector = ''
    if (state === 'oversized-selector') data.steps[0].target!.selector = 'x'.repeat(501)
    render(ReproTimeline, { global, props: { locale: 'en-US', recording: data, busy: state === 'busy' } })
    const button = screen.queryByRole('button', { name: 'Use selector for checkpoint' })
    if (state === 'busy') expect(button).toBeDisabled()
    else expect(button).not.toBeInTheDocument()
  })
})

function step(index: number, kind: BrowserReproStep['kind'] = 'click'): BrowserReproStep {
  return {
    index,
    kind,
    occurredAt: `2026-09-15T10:00:${String(index).padStart(2, '0')}.000Z`,
    elapsedMs: index * 1_000,
    description: `${kind} step ${index}`,
    url: 'https://example.test/private?token=[REDACTED]',
    ...(kind === 'click' ? {
      target: { selector: `main > button:nth-of-type(${index})`, tag: 'button', role: 'button', label: `Action ${index}` }
    } : {})
  }
}

function recording(startedAt: string, steps: BrowserReproStep[], truncated = false): BrowserReproRecording {
  return {
    tabId: 'tab-1',
    title: 'Example',
    startedAt,
    active: false,
    stepCount: steps.length,
    steps,
    truncated,
    caveats: []
  }
}

describe('reproduction timeline navigation', () => {
  it('explains when an action needs a manually supplied selector', () => {
    render(ReproTimeline, {
      global,
      props: { locale: 'en-US', recording: recording('2026-09-15T10:00:00.000Z', [
        { ...step(1), target: { selector: '', tag: 'button' } }
      ]) }
    })
    expect(screen.getByRole('region', { name: 'Selected reproduction step' })).toHaveTextContent('No unique selector; recreate this step manually.')
  })

  it('selects steps with pointer and keyboard navigation and presents focused evidence', async () => {
    render(ReproTimeline, {
      global,
      props: { locale: 'en-US', recording: recording('2026-09-15T10:00:00.000Z', [step(1, 'navigate'), step(2), step(3)]) }
    })
    const user = userEvent.setup()
    const options = screen.getAllByRole('option')

    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: 'Selected reproduction step' })).toHaveTextContent('navigate step 1')

    await user.click(options[2])
    expect(options[2]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: 'Selected reproduction step' })).toHaveTextContent('main > button:nth-of-type(3)')

    options[0].focus()
    await user.keyboard('{ArrowDown}')
    expect(options[1]).toHaveFocus()
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{End}')
    expect(options[2]).toHaveFocus()
    await user.keyboard('{Home}')
    expect(options[0]).toHaveFocus()
  })

  it('resets stale selection for a new recording and supports the capped final step', async () => {
    const first = recording('2026-09-15T10:00:00.000Z', [step(1), step(2), step(3)])
    const view = render(ReproTimeline, { global, props: { locale: 'en-US', recording: first } })
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('option')[2])

    const cappedSteps = Array.from({ length: 200 }, (_, index) => step(index + 1))
    await view.rerender({ locale: 'en-US', recording: recording('2026-09-15T11:00:00.000Z', cappedSteps, true) })
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    options[0].focus()
    await user.keyboard('{End}')
    expect(options[199]).toHaveFocus()
    expect(options[199]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: 'Selected reproduction step' })).toHaveTextContent('click step 200')
  })

  it('does not let delayed keyboard focus override a newer pointer interaction', async () => {
    render(ReproTimeline, {
      global,
      props: { locale: 'en-US', recording: recording('2026-09-15T10:00:00.000Z', [step(1), step(2), step(3)]) }
    })
    const options = screen.getAllByRole('option')
    options[0].focus()

    options[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    options[2].focus()
    options[2].click()
    await nextTick()

    expect(options[2]).toHaveAttribute('aria-selected', 'true')
    expect(options[2]).toHaveFocus()
    expect(screen.getByRole('region', { name: 'Selected reproduction step' })).toHaveTextContent('click step 3')
  })
})

it('requires fresh review after checkpoint fields or context change', async () => {
  const view = render(ReproTimeline, { global, props: { locale: 'en-US', recording: { ...recording('2026-10-01T00:00:00Z', [step(1)]), active: true, checkpointContext: 'c9a69713-c421-4d51-913e-0f7e74248acd' } } })
  const user = userEvent.setup()
  const add = screen.getByRole('button', { name: 'Add checkpoint' })
  await user.type(screen.getByLabelText('Selector', { selector: 'input' }), 'p')
  expect(add).toBeDisabled()
  await user.click(screen.getByRole('checkbox'))
  expect(add).toBeEnabled()
  await user.selectOptions(screen.getByLabelText('Condition'), 'hidden')
  expect(add).toBeDisabled()
  await user.click(screen.getByRole('checkbox'))
  await user.click(add)
  expect(view.emitted('checkpoint')?.[0]).toEqual([{ context: 'c9a69713-c421-4d51-913e-0f7e74248acd', selector: 'p', condition: 'hidden', reviewed: true }])
  expect(add).toBeDisabled()
})


it('requires explicit review for checked expectations and emits no text field', async () => {
  const view = render(ReproTimeline, { global, props: { locale: 'en-US', recording: { ...recording('2026-10-01T00:00:00Z', [step(1)]), active: true, checkpointContext: 'c9a69713-c421-4d51-913e-0f7e74248acd' } } })
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Selector', { selector: 'input' }), '#checkbox')
  await user.selectOptions(screen.getByLabelText('Condition'), 'checked')
  const add = screen.getByRole('button', { name: 'Add checkpoint' })
  expect(add).toBeDisabled()
  expect(screen.queryByLabelText('Exact text', { selector: 'input' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('checkbox'))
  await user.click(add)
  expect(view.emitted('checkpoint')?.[0]).toEqual([{ context: 'c9a69713-c421-4d51-913e-0f7e74248acd', selector: '#checkbox', condition: 'checked', reviewed: true }])
  await user.selectOptions(screen.getByLabelText('Condition'), 'unchecked')
  expect(add).toBeDisabled()
})

it('requires an explicit count, resets review when it changes, and preserves zero', async () => {
  const active = { ...recording('2026-10-01T00:00:00Z', []), active: true, checkpointContext: 'c9a69713-c421-4d51-913e-0f7e74248acd' }
  const view = render(ReproTimeline, { global, props: { locale: 'en-US', recording: active } })
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Selector', { selector: 'input' }), 'ul > li')
  await user.selectOptions(screen.getByLabelText('Condition'), 'count')
  const count = screen.getByRole('spinbutton', { name: 'Element count' })
  const add = screen.getByRole('button', { name: 'Add checkpoint' })
  await user.click(screen.getByRole('checkbox'))
  expect(add).toBeDisabled()
  await user.type(count, '0')
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  await user.click(screen.getByRole('checkbox'))
  await user.click(add)
  expect(view.emitted('checkpoint')?.[0]).toEqual([{ context: active.checkpointContext, selector: 'ul > li', condition: 'count', count: 0, reviewed: true }])
  await user.click(screen.getByRole('checkbox'))
  await user.clear(count)
  expect(add).toBeDisabled()
  await user.click(screen.getByRole('checkbox'))
  expect(add).toBeDisabled()
  await user.type(count, '501')
  await user.click(screen.getByRole('checkbox'))
  expect(add).toBeDisabled()
  await user.clear(count)
  await user.type(count, '3')
  await user.click(screen.getByRole('checkbox'))
  expect(add).toBeEnabled()
  await view.rerender({ recording: { ...active, checkpointContext: '80d44659-5060-4ccf-a97b-b82c03a3e8b2' } })
  expect(add).toBeDisabled()
})

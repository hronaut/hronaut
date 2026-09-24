import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import ReproTimeline from '../../src/renderer/src/components/ReproTimeline.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserReproRecording, BrowserReproStep } from '../../src/shared/types.js'

const global = { plugins: [createHronautI18n('en-US')] }

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

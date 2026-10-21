import { render, screen, within } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import ReproTimeline from '../../src/renderer/src/features/diagnostics/repro-recorder/ReproTimeline.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import {
  REPRO_NAVIGATION_PREFIXES,
  REPRO_UNRESOLVED_ACTION,
  reproClickText,
  reproExpectText,
  reproInputText,
  reproKeyText,
  reproScrollText
} from '../../src/shared/repro-step-text.js'
import type { BrowserReproRecording, BrowserReproStep, BrowserReproTarget } from '../../src/shared/types.js'

const signIn: BrowserReproTarget = { selector: 'main > button', tag: 'button', role: 'button', label: 'Sign in' }
const email: BrowserReproTarget = { selector: 'main > input', tag: 'input', inputType: 'email' }
const oddLabel: BrowserReproTarget = { selector: 'main > button + button', tag: 'button', role: 'button', label: 'a {b} | @:c $d' }

function step(index: number, value: Pick<BrowserReproStep, 'kind' | 'description'> & Partial<BrowserReproStep>): BrowserReproStep {
  return {
    index,
    occurredAt: `2026-09-15T10:00:${String(index).padStart(2, '0')}.000Z`,
    elapsedMs: index * 1_000,
    url: 'https://example.test/app',
    ...value
  }
}

function recording(steps: BrowserReproStep[]): BrowserReproRecording {
  return { tabId: 'tab-1', title: 'Example', startedAt: '2026-09-15T10:00:00.000Z', active: false, stepCount: steps.length, steps, truncated: false, caveats: [] }
}

describe('repro steps in the interface language', () => {
  it('keeps the English sentences main records for MCP results and copied timelines', () => {
    expect(reproClickText(signIn)).toBe('Click button “Sign in”')
    expect(reproInputText(email)).toBe('Type in email input (value not recorded)')
    expect(reproKeyText('Enter', { selector: '', tag: 'div' })).toBe('Press Enter on div')
    expect(reproScrollText({ x: 0, y: 640 })).toBe('Scroll to x=0, y=640')
    expect(reproExpectText('visible')).toBe('Expected result: visible')
    expect(Object.values(REPRO_NAVIGATION_PREFIXES)).toEqual(['Navigate within the page to ', 'Navigate to ', 'Open '])
  })

  it('names each recorded step in German and leaves text it does not recognize as recorded', () => {
    const steps = [
      step(1, { kind: 'navigate', description: `${REPRO_NAVIGATION_PREFIXES.open}https://example.test/app` }),
      step(2, { kind: 'click', description: reproClickText(signIn), target: signIn }),
      step(3, { kind: 'input', description: reproInputText(email), target: email, valueRedacted: true }),
      step(4, { kind: 'key', description: reproKeyText('Enter', email), target: email, key: 'Enter' }),
      step(5, { kind: 'scroll', description: reproScrollText({ x: 0, y: 640 }), scroll: { x: 0, y: 640 } }),
      step(6, { kind: 'navigate', description: `${REPRO_NAVIGATION_PREFIXES.navigateWithin}https://example.test/app#done` }),
      step(7, { kind: 'expect', description: reproExpectText('visible'), target: { selector: 'main > p', tag: 'p' }, expectation: { condition: 'visible', observedMatch: true } }),
      step(8, { kind: 'click', description: REPRO_UNRESOLVED_ACTION.captureInterrupted }),
      step(9, { kind: 'click', description: 'Click button “[REDACTED]”', target: signIn }),
      step(10, { kind: 'navigate', description: `${REPRO_NAVIGATION_PREFIXES.navigate}https://example.test/orders` }),
      step(11, { kind: 'click', description: REPRO_UNRESOLVED_ACTION.captureFailed }),
      step(12, { kind: 'expect', description: reproExpectText('urlPath'), expectation: { condition: 'urlPath', observedMatch: true } }),
      step(13, { kind: 'click', description: reproClickText(oddLabel), target: oddLabel })
    ]
    render(ReproTimeline, { global: { plugins: [createHronautI18n('de-DE')] }, props: { locale: 'de-DE', recording: recording(steps) } })

    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    const summaries = options.map((option) => [option.querySelector('strong')?.textContent, option.querySelector('small')?.textContent])
    expect(summaries).toEqual([
      ['Navigation', 'Öffnen: https://example.test/app'],
      ['Klick', 'button „Sign in“ anklicken'],
      ['Eingabe', 'In email-Eingabefeld tippen (Wert nicht aufgezeichnet)'],
      ['Taste', 'Enter in email-Eingabefeld drücken'],
      ['Scrollen', 'Zu x=0, y=640 scrollen'],
      ['Navigation', 'Innerhalb der Seite navigieren zu https://example.test/app#done'],
      ['Prüfpunkt', 'Erwartetes Ergebnis: sichtbar'],
      ['Klick', 'Die Erfassung der Aktion wurde durch eine Navigation unterbrochen. Diese Aktion manuell nachbilden.'],
      ['Klick', 'Click button “[REDACTED]”'],
      ['Navigation', 'Navigieren zu https://example.test/orders'],
      ['Klick', 'Das Ziel der Aktion konnte nicht erfasst werden. Diese Aktion manuell nachbilden.'],
      ['Prüfpunkt', 'Erwartetes Ergebnis: URL-Pfad'],
      // Page text is only ever a parameter, so message syntax in a label shows as the page wrote it.
      ['Klick', 'button „a {b} | @:c $d“ anklicken']
    ])
    const detail = screen.getByRole('region', { name: 'Ausgewählter Reproduktionsschritt' })
    expect(detail.querySelector('header strong')).toHaveTextContent('Öffnen: https://example.test/app')
    expect(within(detail).getByText('Aktion').nextElementSibling).toHaveTextContent(/^Navigation$/)
  })

  it('shows each English step exactly as main recorded it', () => {
    const steps = [
      step(1, { kind: 'navigate', description: `${REPRO_NAVIGATION_PREFIXES.open}https://example.test/app` }),
      step(2, { kind: 'navigate', description: `${REPRO_NAVIGATION_PREFIXES.navigate}https://example.test/orders` }),
      step(3, { kind: 'navigate', description: `${REPRO_NAVIGATION_PREFIXES.navigateWithin}https://example.test/orders#done` }),
      step(4, { kind: 'click', description: reproClickText(signIn), target: signIn }),
      step(5, { kind: 'click', description: reproClickText(oddLabel), target: oddLabel }),
      step(6, { kind: 'input', description: reproInputText(email), target: email, valueRedacted: true }),
      step(7, { kind: 'key', description: reproKeyText('Enter', { selector: '', tag: 'div' }), target: { selector: '', tag: 'div' }, key: 'Enter' }),
      step(8, { kind: 'scroll', description: reproScrollText({ x: 12, y: 640 }), scroll: { x: 12, y: 640 } }),
      ...(['visible', 'hidden', 'text', 'checked', 'unchecked', 'count', 'urlPath'] as const).map((condition, index) =>
        step(9 + index, { kind: 'expect', description: reproExpectText(condition), expectation: { condition, observedMatch: true } })),
      step(16, { kind: 'click', description: REPRO_UNRESOLVED_ACTION.captureFailed }),
      step(17, { kind: 'click', description: REPRO_UNRESOLVED_ACTION.captureInterrupted })
    ]
    render(ReproTimeline, { global: { plugins: [createHronautI18n('en-US')] }, props: { locale: 'en-US', recording: recording(steps) } })

    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options.map((option) => option.querySelector('small')?.textContent)).toEqual(steps.map((recorded) => recorded.description))
    expect(options.map((option) => option.querySelector('strong')?.textContent)).toEqual(steps.map((recorded) => recorded.kind))
  })
})

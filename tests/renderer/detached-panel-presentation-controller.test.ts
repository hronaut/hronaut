import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resolveDetachedPanelId,
  useDetachedPanelPresentationController
} from '../../src/renderer/src/composables/useDetachedPanelPresentationController.js'

afterEach(() => {
  document.documentElement.removeAttribute('data-panel-window')
  document.title = ''
})

describe('detached panel presentation controller', () => {
  it('accepts only known detached panel query values', () => {
    expect(resolveDetachedPanelId('?hronautPanel=network')).toBe('network')
    expect(resolveDetachedPanelId('?hronautPanel=site-controls&extra=1')).toBe('site-controls')
    expect(resolveDetachedPanelId('?hronautPanel=unknown')).toBeNull()
    expect(resolveDetachedPanelId('')).toBeNull()
  })

  it('owns detached-window labeling and document metadata', () => {
    const translate = vi.fn((key: string, params?: Record<string, unknown>) => (
      key === 'panels.title' ? `${String(params?.panel)} — Hronaut` : key === 'panels.network' ? 'Network' : key
    ))
    const controller = useDetachedPanelPresentationController({
      search: '?hronautPanel=network',
      translate,
      targetDocument: document
    })

    expect(controller.isDetachedPanelWindow).toBe(true)
    expect(document.documentElement.dataset.panelWindow).toBe('true')
    expect(document.title).toBe('Network — Hronaut')

    controller.setActivePanelTitle('console')
    expect(document.title).toBe('panels.console — Hronaut')
  })

  it('does not mutate a normal window title when a panel activates', () => {
    document.title = 'Hronaut'
    const controller = useDetachedPanelPresentationController({
      search: '',
      translate: (key) => key,
      targetDocument: document
    })

    controller.setActivePanelTitle('network')
    expect(controller.isDetachedPanelWindow).toBe(false)
    expect(document.title).toBe('Hronaut')
  })
})

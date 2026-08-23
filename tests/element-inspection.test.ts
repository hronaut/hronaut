import { describe, expect, it } from 'vitest'
import {
  formatElementInspectionForAgent,
  normalizeElementInspection
} from '../src/shared/element-inspection.js'

describe('element inspection', () => {
  it('normalizes bounded computed evidence and formats agent-ready context', () => {
    const report = normalizeElementInspection({
      tabId: 'tab-1',
      title: 'Profile editor',
      url: 'https://example.com/profile?token=secret#form',
      capturedAt: '2026-08-15T12:00:00.000Z',
      raw: {
        selector: '#save-profile',
        tag: 'BUTTON',
        text: 'Save profile',
        attributes: [
          { name: 'id', value: 'save-profile' },
          { name: 'class', value: 'primary action' },
          { name: 'value', value: 'private-form-value' },
          { name: 'onclick', value: 'sendSecret()' }
        ],
        box: {
          x: 20.4,
          y: 30.6,
          width: 140,
          height: 44,
          contentWidth: 112,
          contentHeight: 20,
          boxSizing: 'border-box',
          padding: { top: 10, right: 12, bottom: 10, left: 12 },
          border: { top: 2, right: 2, bottom: 2, left: 2 },
          margin: { top: 0, right: 8, bottom: 0, left: 8 }
        },
        layout: { display: 'flex', position: 'relative', zIndex: '2', visibility: 'visible', opacity: '1', overflowX: 'hidden', overflowY: 'auto' },
        typography: { color: 'rgb(255, 255, 255)', backgroundColor: 'rgb(60, 40, 180)', fontFamily: 'Inter', fontSize: '14px', fontWeight: '700', lineHeight: '20px', letterSpacing: '0px', textAlign: 'center', whiteSpace: 'nowrap', contrastRatio: 7.14 },
        accessibility: { role: 'button', name: 'Save profile', focusable: true, disabled: false }
      }
    })
    const formatted = formatElementInspectionForAgent(report)

    expect(report.url).toContain('token=%5BREDACTED%5D')
    expect(report.url).not.toContain('#form')
    expect(report.attributes).toEqual([
      { name: 'id', value: 'save-profile' },
      { name: 'class', value: 'primary action' }
    ])
    expect(report.box).toMatchObject({ contentWidth: 112, contentHeight: 20, boxSizing: 'border-box' })
    expect(report.typography.contrastRatio).toBe(7.14)
    expect(formatted).toContain('Selector: #save-profile')
    expect(formatted).toContain('Element: <button id="save-profile" class="primary action">Save profile</button>')
    expect(formatted).toContain('Box model: content=112×20px')
    expect(formatted).toContain('Layout: display=flex')
    expect(formatted).toContain('Accessibility: role=button; name="Save profile"; focusable=true')
    expect(formatted).toContain('Contrast: 7.14:1')
    expect(formatted).not.toContain('private-form-value')
    expect(formatted).not.toContain('sendSecret')
  })

  it('rejects a report without a usable selector and bounds hostile numbers', () => {
    expect(() => normalizeElementInspection({ tabId: 'tab-1', title: '', url: 'about:blank', raw: {} })).toThrow(/usable selector/)
    const report = normalizeElementInspection({
      tabId: 'tab-1',
      title: '',
      url: 'about:blank',
      raw: {
        selector: 'body > div',
        tag: 'div',
        box: { width: Infinity, height: -50 },
        layout: {},
        typography: {},
        accessibility: {}
      }
    })
    expect(report.box.width).toBe(0)
    expect(report.box.height).toBe(0)
  })
})

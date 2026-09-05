import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ShellTitleBarSurface from '../../src/renderer/src/components/ShellTitleBarSurface.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import appIcon from '../../build/icons/64x64.png'

describe('title-bar identity', () => {
  it.each([true, false])('uses the canonical app icon without making it draggable when window dragging is %s', draggable => {
    const wrapper = mount(ShellTitleBarSurface, {
      props: { kind: 'rail', draggable },
      global: { plugins: [createHronautI18n('en-US')] }
    })
    const icon = wrapper.get('img')
    expect(icon.attributes()).toMatchObject({ src: appIcon, alt: '', draggable: 'false' })
    expect(wrapper.text()).toBe('Hronaut')
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.attributes('data-titlebar-drag-surface')).toBe(draggable ? '' : undefined)
    wrapper.unmount()
  })

  it('keeps the Home surface identifiable as Home', () => {
    const wrapper = mount(ShellTitleBarSurface, {
      props: { kind: 'home', draggable: true },
      global: { plugins: [createHronautI18n('en-US')] }
    })
    expect(wrapper.text()).toBe('Home')
    expect(wrapper.find('svg').exists()).toBe(true)
    wrapper.unmount()
  })
})

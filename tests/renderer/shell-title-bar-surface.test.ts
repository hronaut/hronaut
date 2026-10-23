import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ShellTitleBarSurface from '../../src/renderer/src/components/ShellTitleBarSurface.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import appIcon from '../../build/icons/64x64.png'
import IconDashboard from '~icons/material-symbols/space-dashboard-rounded'

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

  // Home's title bar showed the app's logo while Settings showed its own icon, so the two page titles did not match.
  it('marks Home with the Home button\'s icon in the same badge as Settings', () => {
    const home = mount(ShellTitleBarSurface, {
      props: { kind: 'home', draggable: true },
      global: { plugins: [createHronautI18n('en-US')] }
    })
    const settings = mount(ShellTitleBarSurface, {
      props: { kind: 'settings', draggable: true },
      global: { plugins: [createHronautI18n('en-US')] }
    })
    const sidebarIcon = mount(IconDashboard)
    expect(home.text()).toBe('Home')
    expect(home.find('img').exists()).toBe(false)
    expect(home.get('.shell-title-bar-mark svg').html()).toBe(sidebarIcon.html())
    expect(home.get('.shell-title-bar-mark').classes()).toEqual(settings.get('.shell-title-bar-mark').classes())
    home.unmount()
    settings.unmount()
    sidebarIcon.unmount()
  })

  it('identifies Settings in the title bar with its own icon', () => {
    const wrapper = mount(ShellTitleBarSurface, {
      props: { kind: 'settings', draggable: true },
      global: { plugins: [createHronautI18n('en-US')] }
    })
    expect(wrapper.text()).toBe('Settings')
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.find('img').exists()).toBe(false)
    wrapper.unmount()
  })
})

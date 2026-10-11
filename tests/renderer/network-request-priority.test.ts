import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import NetworkRequestPriority from '../../src/renderer/src/components/NetworkRequestPriority.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { networkPriorityMessages } from '../../src/shared/locales/network-priority.js'
import type { SupportedLocale } from '../../src/shared/locale.js'

describe('selected request priority', () => {
  it('shows unavailable explicitly, then updates the selected snapshot', async () => {
    const wrapper = mount(NetworkRequestPriority, { global: { plugins: [createHronautI18n('en-US')] } })
    try {
      expect(wrapper.findAll('dd').map(node => node.text())).toEqual(['Unavailable', 'Unavailable'])
      await wrapper.setProps({ priority: { initial: 'Low', latestObserved: 'High' } })
      expect(wrapper.findAll('dd').map(node => node.text())).toEqual(['Low', 'High'])
      await wrapper.setProps({ priority: { initial: 'Low', latestObserved: null } })
      expect(wrapper.findAll('dd').map(node => node.text())).toEqual(['Low', 'Unavailable'])
      expect(wrapper.text()).toContain('not a final priority')
      expect(wrapper.text()).toContain('LCP cause')
    } finally { wrapper.unmount() }
  })
  it.each(Object.keys(networkPriorityMessages) as SupportedLocale[])('localizes accessible observations in %s', locale => {
    const messages = networkPriorityMessages[locale]
    const wrapper = mount(NetworkRequestPriority, { props: { priority: { initial: 'VeryLow', latestObserved: 'VeryHigh' } }, global: { plugins: [createHronautI18n(locale)] } })
    try {
      expect(wrapper.get('section').attributes('aria-label')).toBe(messages.heading)
      expect(wrapper.findAll('dt').map(node => node.text())).toEqual([messages.initial, messages.latest])
      expect(wrapper.findAll('dd').map(node => node.text())).toEqual([messages.VeryLow, messages.VeryHigh])
      expect(wrapper.text()).toContain(messages.note)
      expect(wrapper.text()).not.toContain('networkPriority.')
    } finally { wrapper.unmount() }
  })
})

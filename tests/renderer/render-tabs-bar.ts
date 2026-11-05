import { render, type RenderOptions } from '@testing-library/vue'
import { nextTick, shallowRef } from 'vue'
import BrowserTabsBar from '../../src/renderer/src/features/tabs/BrowserTabsBar.vue'
import type { BrowserState, McpTabActivity } from '../../src/shared/types.js'

type TabsBarProps = InstanceType<typeof BrowserTabsBar>['$props']

/** The tab bar's props as a test gives them: the state and the agents' tools as values, which the bar reads through functions. */
export type TabsBarTestProps = Omit<TabsBarProps, 'readState' | 'readMcpActivity'> & {
  state: BrowserState
  mcpActivityByTab?: Record<string, McpTabActivity>
}

/**
 * Renders the tab bar as the shell does: it reads the state and the agents' tools through functions, and a state or
 * tools given to rerender reach it as a new state from the shell's store does, without new props.
 */
export function renderTabsBar(options: Omit<RenderOptions<typeof BrowserTabsBar>, 'props'> & { props: TabsBarTestProps }) {
  const { state, mcpActivityByTab, ...props } = options.props
  const current = shallowRef(state)
  const activity = shallowRef(mcpActivityByTab ?? {})
  const view = render(BrowserTabsBar, { ...options, props: { ...props, readState: () => current.value, readMcpActivity: () => activity.value } })
  return {
    ...view,
    async rerender(next: Partial<TabsBarTestProps>): Promise<void> {
      const { state: nextState, mcpActivityByTab: nextActivity, ...rest } = next
      if (nextState) current.value = nextState
      if (nextActivity) activity.value = nextActivity
      if (Object.keys(rest).length > 0) await view.rerender(rest)
      else await nextTick()
    }
  }
}

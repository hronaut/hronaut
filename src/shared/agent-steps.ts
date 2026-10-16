/**
 * Plain-words kinds of agent step, for the toolbar's agent avatars and later
 * Home's activity feed. A kind names what the agent is doing in general terms
 * only: never a target, an address, page text or a typed value.
 */
export const AGENT_STEP_KINDS = [
  'click',
  'type',
  'fillForm',
  'choose',
  'pressKey',
  'hover',
  'scroll',
  'drag',
  'navigate',
  'history',
  'openTab',
  'switchTab',
  'closeTab',
  'read',
  'screenshot',
  'wait',
  'script',
  'upload',
  'askYou',
  'inspect',
  'working'
] as const

export type AgentStepKind = (typeof AGENT_STEP_KINDS)[number]

const STEP_BY_TOOL: Readonly<Record<string, AgentStepKind>> = {
  browser_click: 'click',
  browser_dialog: 'click',
  browser_type: 'type',
  browser_fill_form: 'fillForm',
  browser_select: 'choose',
  browser_press: 'pressKey',
  browser_hold_key: 'pressKey',
  browser_hover: 'hover',
  browser_scroll: 'scroll',
  browser_wheel: 'scroll',
  browser_drag: 'drag',
  browser_navigate: 'navigate',
  browser_history: 'history',
  browser_new_tab: 'openTab',
  browser_select_tab: 'switchTab',
  browser_show: 'switchTab',
  browser_close_tab: 'closeTab',
  browser_snapshot: 'read',
  browser_find: 'read',
  browser_public_outcome: 'read',
  browser_screenshot: 'screenshot',
  browser_pdf_save: 'screenshot',
  browser_visual_compare: 'screenshot',
  browser_wait: 'wait',
  browser_network_wait: 'wait',
  browser_evaluate: 'script',
  browser_evaluate_file: 'script',
  browser_webmcp: 'script',
  browser_file_upload: 'upload',
  browser_request_user_attention: 'askYou',
  browser_human_waiting: 'askYou'
}

const INSPECT_TOOL = /^browser_(?:console|network|issues|performance|accessibility_audit|quality_audit|design_overview|page_metadata|security|react|code_coverage|cpu_profile|memory|debug_report|dom_changes|live_region|css_state_preview|element_inspect|image_state|media_state|generate_locator|storage|indexeddb|pwa|diagnostic_logs|site_data|downloads)/u

export function agentStepKind(toolName: string): AgentStepKind {
  return STEP_BY_TOOL[toolName] ?? (INSPECT_TOOL.test(toolName) ? 'inspect' : 'working')
}

/** Steps that change the page or the tabs. An agent taking one has moved on from waiting for you;
 * reading, waiting, scrolling or showing a tab does not count. */
const ACTING_STEPS: ReadonlySet<AgentStepKind> = new Set<AgentStepKind>([
  'click', 'type', 'fillForm', 'choose', 'pressKey', 'drag', 'navigate', 'history', 'openTab', 'closeTab', 'upload'
])

export function agentStepActs(kind: AgentStepKind): boolean {
  return ACTING_STEPS.has(kind)
}

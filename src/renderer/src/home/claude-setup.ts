import type { ClaudeCodeSetupPreview, HomeSetupState } from '../../../shared/claude-code-setup.js'
import { claudeCodeSetupErrorCode } from '../../../shared/claude-code-setup.js'
import type { HomeBootstrap, HomeDashboard, HronautHomeApi } from '../../../shared/home.js'
import { element, interpolate } from './dom.js'

/**
 * "Set up Claude Code" on the Claude Code guide: Home asks main for the exact change and shows it, and main asks the
 * person natively before it writes anything. Each step checks it is still the newest, so a late answer never overwrites
 * what the person did since.
 */
export function mountClaudeSetup(data: HomeBootstrap, api: HronautHomeApi, signal: AbortSignal) {
  const messages = data.messages.home.connect.claudeSetup
  const root = document.getElementById('claude-setup')
  // Without the panel (MCP authentication on) Home still learns which agents are installed.
  const readState = async (): Promise<HomeSetupState | null> => { try { return await api?.getSetupState?.() ?? null } catch { return null } }
  if (!root || !api?.getSetupState || !api.prepareClaudeCodeSetup || !api.applyClaudeCodeSetup) {
    return { show: (_visible: boolean): void => {}, refresh: readState, update: (_dashboard: HomeDashboard): void => {}, start: (): void => {}, offered: (): boolean => false }
  }
  const start = element<HTMLButtonElement>('claude-setup-start')
  const status = element('claude-setup-status')
  const panel = element('claude-setup-preview')
  const apply = element<HTMLButtonElement>('claude-setup-apply')
  const cancel = element<HTMLButtonElement>('claude-setup-cancel')
  let setup: HomeSetupState | null = null
  let preview: ClaudeCodeSetupPreview | null = null
  let connected = false
  let shown = false
  let sequence = 0
  /** What was just done or went wrong; otherwise the line says what the settings file says. */
  let notice = ''

  const failure = (error: unknown): string => {
    const code = claudeCodeSetupErrorCode(error)
    const path = setup?.claudeCode?.path ?? ''
    if (code === 'not-found') return interpolate(messages.notFound, { path })
    if (code === 'unreadable') return interpolate(messages.unreadable, { path })
    if (code === 'configured') return messages.configured
    if (code === 'expired' || code === 'changed' || code === 'busy') return messages[code]
    return messages.failed
  }

  function render(): void {
    const claude = setup?.claudeCode
    root!.hidden = !shown || !claude
    if (root!.hidden || !claude) return
    start.hidden = preview !== null || !(claude.state === 'not-configured' || claude.state === 'other-address')
    start.textContent = claude.state === 'other-address' ? messages.update : messages.action
    panel.hidden = preview === null
    const known = claude.state === 'configured' ? (connected ? messages.connected : messages.configured)
      : claude.state === 'other-address' ? messages.otherAddress
        : claude.state === 'not-found' ? interpolate(messages.notFound, { path: claude.path })
          : claude.state === 'unreadable' ? interpolate(messages.unreadable, { path: claude.path }) : ''
    const line = preview ? '' : notice || known
    if (status.textContent !== line) status.textContent = line
  }

  async function refresh(): Promise<HomeSetupState | null> {
    const current = sequence
    const next = await readState()
    // A step the person took meanwhile has its own answer coming; a failed read keeps the command above as the way.
    if (!next || current !== sequence || signal.aborted) return setup
    setup = next
    render()
    return setup
  }

  function settle(message: string): void {
    sequence++
    preview = null
    notice = message
    start.disabled = false; apply.disabled = false; cancel.disabled = false
    render()
    void refresh()
  }

  start.addEventListener('click', async () => {
    if (start.disabled) return
    const current = ++sequence
    start.disabled = true
    notice = messages.preparing
    render()
    try {
      const next = await api.prepareClaudeCodeSetup!()
      if (current !== sequence || signal.aborted) return
      start.disabled = false
      preview = next
      notice = ''
      element('claude-setup-intro').textContent = interpolate(messages.previewIntro, { path: next.path })
      element('claude-setup-after').textContent = `"hronaut": ${next.after}`
      element('claude-setup-before-wrap').hidden = next.before === null
      element('claude-setup-before').textContent = next.before === null ? '' : `"hronaut": ${next.before}`
      element('claude-setup-backup').textContent = interpolate(messages.previewBackup, { name: next.backupName })
      render()
      apply.focus({ preventScroll: true })
    } catch (error) {
      if (current === sequence && !signal.aborted) settle(failure(error))
    }
  }, { signal })

  apply.addEventListener('click', async () => {
    if (!preview || apply.disabled) return
    const current = ++sequence
    apply.disabled = true; cancel.disabled = true
    notice = messages.applying
    const planId = preview.planId
    status.textContent = notice
    try {
      const result = await api.applyClaudeCodeSetup!(planId)
      if (current !== sequence || signal.aborted) return
      settle(result.outcome === 'applied' ? interpolate(messages.applied, { name: result.backupName }) : messages.cancelled)
    } catch (error) {
      if (current === sequence && !signal.aborted) settle(failure(error))
    }
    if (current + 1 === sequence && !signal.aborted) (start.hidden ? element('guide-code').closest('pre')! : start).focus({ preventScroll: true })
  }, { signal })

  cancel.addEventListener('click', () => { settle(messages.cancelled); start.focus({ preventScroll: true }) }, { signal })

  return {
    /** Shown with the Claude Code guide only; leaving it drops a change that was not applied. */
    show(visible: boolean): void {
      if (shown === visible) return
      shown = visible
      if (!visible) { sequence++; preview = null; notice = ''; start.disabled = false; apply.disabled = false; cancel.disabled = false }
      render()
      if (visible) void refresh()
    },
    refresh,
    /** "Claude Code is connected" once it is. */
    update(dashboard: HomeDashboard): void {
      const next = dashboard.status === 'ready' && (dashboard.agents ?? []).some(agent => agent.name === 'Claude Code')
      if (next === connected) return
      connected = next
      if (connected) notice = ''
      render()
    },
    /** From the first-run panel: show the change straight away. */
    start(): void { if (shown && !start.hidden && !start.disabled) start.click() },
    /** Whether Home can offer to add Hronaut to Claude Code right now. */
    offered(): boolean { return setup?.claudeCode?.state === 'not-configured' || setup?.claudeCode?.state === 'other-address' }
  }
}

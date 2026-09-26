import type { HomeBootstrap, HomeDashboard, HronautHomeApi } from '../../../shared/home.js'
import { element, escapeText as h, interpolate, remember } from './dom.js'
import { mountWorkspaces } from './workspaces.js'

export function mountHome(data: HomeBootstrap, api: HronautHomeApi, load: typeof fetch = fetch) {
  const { guides, locale } = data
  const messages = data.messages.home
  const library = data.messages.workspaceLibrary
  let dashboard = data.dashboard
  const revision = dashboard.presentationRevision
  const lifetime = new AbortController()
  const signal = lifetime.signal
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const later = (callback: () => void, delay: number): ReturnType<typeof setTimeout> => {
    const timer = setTimeout(() => { timers.delete(timer); if (!signal.aborted) callback() }, delay)
    timers.add(timer); return timer
  }
  const text = (id: string, value: string | number): void => { element(id).textContent = String(value) }
  const count = (one: string, other: string, value: number): string => interpolate(value === 1 ? one : other, { count: new Intl.NumberFormat(locale).format(value) })
  let selectedGuide = guides.find(guide => guide.id === remember('hronaut.home.guide'))?.id ?? guides[0]!.id
  let guideSequence = 0
  let vscodeSequence = 0
  const guideButton = document.querySelector<HTMLButtonElement>('[data-agent-guide]')!
  const vscodeButton = document.querySelector<HTMLButtonElement>('[data-vscode-install]')
  type CopyState = { label: string; title: string; sequence: number; timer?: ReturnType<typeof setTimeout> }
  const copyStates = new Map<HTMLButtonElement, CopyState>()
  const guideLabel = (): string => interpolate(messages.connect.openGuide, { name: guides.find(guide => guide.id === selectedGuide)!.name })
  const resetCopies = (): void => {
    copyStates.forEach((state, button) => {
      if (!button.dataset.copyTarget?.startsWith('guide-')) return
      state.sequence++; clearTimeout(state.timer)
      button.textContent = state.label; button.title = state.title
    })
    text('copy-status', '')
  }
  function renderGuide(): void {
    const guide = guides.find(guide => guide.id === selectedGuide)!
    document.querySelectorAll<HTMLButtonElement>('[data-guide]').forEach(button => {
      const active = button.dataset.guide === selectedGuide
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active))
    })
    text('guide-name', guide.name); text('guide-note', guide.note); text('guide-location', guide.location); text('guide-code', guide.code)
    element('guide-setup').hidden = !guide.setupCommand; text('guide-setup-command', guide.setupCommand ?? '')
    element('guide-verify').hidden = !guide.verifyCommand; text('guide-verify-command', guide.verifyCommand ?? '')
    guideSequence++; vscodeSequence++
    guideButton.disabled = false; guideButton.title = ''; guideButton.textContent = guideLabel(); text('guide-open-status', '')
    if (vscodeButton) {
      element('guide-primary-action').hidden = guide.action !== 'open-vscode-install'
      vscodeButton.disabled = false; vscodeButton.title = ''; text('guide-primary-status', '')
    }
    resetCopies()
  }
  const agentList = element('agent-list')
  for (const guide of guides) {
    const button = document.createElement('button')
    button.type = 'button'; button.className = 'agent-button'; button.dataset.guide = guide.id; button.textContent = guide.name
    button.addEventListener('click', () => { selectedGuide = guide.id; remember('hronaut.home.guide', guide.id); renderGuide() }, { signal })
    agentList.append(button)
  }
  guideButton.addEventListener('click', async () => {
    if (guideButton.disabled) return
    const sequence = ++guideSequence
    guideButton.disabled = true; guideButton.title = ''; text('guide-open-status', ''); guideButton.textContent = guideLabel()
    try {
      if (!api?.openAgentGuide) throw new Error(messages.connect.guideUnavailable)
      await api.openAgentGuide(selectedGuide)
    } catch (error) {
      if (sequence !== guideSequence || signal.aborted) return
      guideButton.title = error instanceof Error ? error.message : messages.connect.guideUnavailable
      text('guide-open-status', guideButton.title); guideButton.textContent = `${messages.journey.retry} · ${guideLabel()}`
    } finally { if (sequence === guideSequence && !signal.aborted) guideButton.disabled = false }
  }, { signal })
  vscodeButton?.addEventListener('click', async () => {
    if (vscodeButton.disabled) return
    const sequence = ++vscodeSequence
    vscodeButton.disabled = true; text('guide-primary-status', messages.connect.openingVsCode)
    try {
      if (!api?.openVsCodeInstall) throw new Error(messages.connect.vscodeUnavailable)
      await api.openVsCodeInstall()
      if (sequence === vscodeSequence && !signal.aborted) text('guide-primary-status', messages.connect.vscodeOpened)
    } catch (error) {
      if (sequence === vscodeSequence && !signal.aborted) {
        text('guide-primary-status', messages.connect.vscodeFailed)
        vscodeButton.title = error instanceof Error ? error.message : messages.connect.vscodeUnavailable
      }
    } finally { if (sequence === vscodeSequence && !signal.aborted) vscodeButton.disabled = false }
  }, { signal })
  for (const [id, method, status, unavailable, label] of [
    ['support-feedback', 'openSetupFeedback', 'support-feedback-status', messages.support.feedbackUnavailable, messages.support.reportTrouble],
    ['support-troubleshoot', 'openSetupHelp', 'support-help-status', messages.support.troubleshootUnavailable, messages.support.troubleshoot]
  ] as const) {
    const button = element<HTMLButtonElement>(id)
    button.addEventListener('click', async () => {
      if (button.disabled) return
      button.disabled = true; button.title = ''; button.textContent = label; text(status, '')
      try { if (!api?.[method]) throw new Error(unavailable); await api[method]() }
      catch (error) {
        if (signal.aborted) return
        button.title = error instanceof Error ? error.message : unavailable
        text(status, button.title); button.hidden = false; button.textContent = `${messages.journey.retry} · ${label}`
      } finally { if (!signal.aborted) button.disabled = false }
    }, { signal })
  }
  document.querySelectorAll<HTMLButtonElement>('[data-copy-target]').forEach(button => {
    const state: CopyState = { label: button.textContent ?? '', title: button.title, sequence: 0 }
    copyStates.set(button, state)
    button.addEventListener('click', async () => {
      const target = element(button.dataset.copyTarget!)
      const value = target.textContent ?? ''
      const sequence = ++state.sequence
      clearTimeout(state.timer); button.title = state.title; text('copy-status', '')
      try {
        if (!api?.copyText) throw new Error(messages.copy.unavailable)
        await api.copyText(value)
        if (signal.aborted || sequence !== state.sequence || target.textContent !== value) return
        button.textContent = messages.copy.copied
      } catch (error) {
        if (signal.aborted || sequence !== state.sequence || target.textContent !== value) return
        button.textContent = messages.copy.failed
        button.title = error instanceof Error ? error.message : messages.copy.rejected
        text('copy-status', `${messages.copy.failed} ${messages.copy.rejected}`)
        const selection = window.getSelection(); const range = document.createRange()
        range.selectNodeContents(target); selection?.removeAllRanges(); selection?.addRange(range)
      }
      state.timer = later(() => { if (sequence === state.sequence) { button.textContent = state.label; button.title = state.title } }, 1200)
    }, { signal })
  })
  let observedTools: string[] | null = null
  function renderReadiness(): void {
    const report = structuredClone(dashboard.readiness)
    if (observedTools !== null) {
      const advertised = [...new Set(dashboard.tools.map(tool => tool.name).filter(name => /^(?:browser|wallet)_[a-z0-9_]{1,80}$/.test(name)))].sort()
      const missing = advertised.filter(name => !observedTools!.includes(name))
      const complete = advertised.length > 0 && !missing.length
      report.checks.clientVisibility = { state: complete ? 'client_tools_verified' : 'partial_tool_inventory', nextAction: complete ? 'none' : 'list_tools_in_active_client', evidence: { observedToolCount: advertised.length - missing.length, missingToolCount: missing.length, ...(missing.length ? { missingTools: missing.slice(0, 12) } : {}) } }
    }
    element('readiness-checks').innerHTML = Object.entries(report.checks).map(([name, check]) => `<div class="readiness-check"><div><strong>${h(messages.readiness.checks[name as keyof typeof report.checks])}</strong><span>${h(messages.readiness.nextAction[check.nextAction])}</span></div><code class="readiness-state ${h(check.state)}">${h(check.state)}</code></div>`).join('')
    text('readiness-report', JSON.stringify(report, null, 2))
  }
  element('readiness-verify').addEventListener('click', () => {
    observedTools = [...new Set(Array.from(element<HTMLTextAreaElement>('readiness-tool-inventory').value.matchAll(/(?:^|[^a-z0-9_])((?:browser|wallet)_[a-z0-9_]{1,80})(?=$|[^a-z0-9_])/g), match => match[1]!))]
    renderReadiness()
  }, { signal })
  let renderedCatalog = ''
  function renderTools(): void {
    const query = element<HTMLInputElement>('tool-search').value.trim().toLocaleLowerCase(locale)
    const tools = dashboard.tools.filter(tool => `${tool.name} ${tool.category} ${tool.description}`.toLocaleLowerCase(locale).includes(query))
    element('tool-empty').hidden = !query || tools.length > 0
    if (JSON.stringify(tools) === renderedCatalog) return
    renderedCatalog = JSON.stringify(tools)
    const grid = element('tool-grid')
    for (const child of Array.from(grid.children) as HTMLElement[]) if (!tools.some(tool => tool.name === child.dataset.tool)) child.remove()
    for (const tool of tools) {
      let details = Array.from(grid.children).find(child => (child as HTMLElement).dataset.tool === tool.name) as HTMLDetailsElement | undefined
      if (!details) {
        details = document.createElement('details'); details.className = 'tool'; details.dataset.tool = tool.name
        details.innerHTML = `<summary><span class="tool-top"><code>${h(tool.name)}</code><span class="category">${h(tool.category)}</span></span></summary><p></p>`
        grid.append(details)
      }
      details.querySelector('p')!.textContent = tool.description
    }
  }
  const relativeTime = (value: string): string => {
    const elapsed = Date.now() - new Date(value).getTime()
    if (elapsed < 5000) return messages.relativeTime.now
    if (elapsed < 3600000) return interpolate(messages.relativeTime[elapsed < 60000 ? 'seconds' : 'minutes'], { count: new Intl.NumberFormat(locale).format(Math.floor(elapsed / (elapsed < 60000 ? 1000 : 60000))) })
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  }
  function update(next: HomeDashboard): void {
    if (signal.aborted) return
    dashboard = next
    document.documentElement.dataset.theme = dashboard.theme ?? 'light'
    const status = dashboard.status
    const statusLabels = { starting: messages.status.starting, ready: messages.status.online, paused: messages.status.paused, error: messages.status.error }
    element('server-state').innerHTML = `<span class="dot ${status}"></span> ${h(statusLabels[status])}`
    element('server-state').title = status === 'error' ? dashboard.error ?? messages.status.unknownError : ''
    text('active-count', status === 'paused' ? messages.status.pausedValue : status === 'error' ? messages.status.unavailable : status === 'starting' ? messages.status.startingValue : count(messages.status.activeOne, messages.status.activeOther, dashboard.activeRequests))
    text('request-count', dashboard.totalRequests ? count(messages.counts.requestsOne, messages.counts.requestsOther, dashboard.totalRequests) : messages.status.waiting)
    text('client-count', count(messages.counts.clientsOne, messages.counts.clientsOther, dashboard.clients.length))
    text('tool-count', interpolate(messages.counts.tools, { count: new Intl.NumberFormat(locale).format(dashboard.tools.length) }))
    text('server-version', `Hronaut ${dashboard.version}`)
    const completed = dashboard.completedToolCalls || 0
    const successful = Math.max(0, completed - dashboard.toolMetrics.reduce((total, metric) => total + metric.failures, 0))
    text('activity-count', count(messages.counts.actionsOne, messages.counts.actionsOther, completed))
    text('completed-count', new Intl.NumberFormat(locale).format(completed)); text('tool-types-count', dashboard.toolMetrics.length)
    text('success-rate', completed ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(successful / completed) : '—')
    renderReadiness()
    text('support-kicker', successful ? messages.support.activeKicker : messages.support.kicker)
    text('support-heading', successful ? count(messages.support.activeHeadingOne, messages.support.activeHeadingOther, successful) : completed ? messages.support.failedHeading : messages.support.heading)
    text('support-message', successful ? messages.support.activeMessage : completed ? messages.support.failedMessage : messages.support.message)
    const help = element('support-troubleshoot')
    help.hidden = successful > 0 && document.activeElement !== help && !element('support-help-status').textContent
    if (!element('support-feedback-status').textContent) text('support-feedback', successful ? messages.support.feedback : messages.support.reportTrouble)
    element('support-recommend').hidden = !successful; element('support-welcome').hidden = successful > 0; element('support-recommend-privacy').hidden = !successful
    const outcomes = { succeeded: messages.activity.done, failed: messages.activity.failed, cancelled: messages.activity.cancelled, blocked: messages.activity.blocked, 'timed-out': messages.activity.timedOut, interrupted: messages.activity.interrupted, 'outcome-unknown': messages.activity.unknown }
    element('activity-list').innerHTML = dashboard.recentActivity.length ? dashboard.recentActivity.slice(0, 8).map(activity => {
      const outcome = activity.result?.outcome ?? (activity.outcome === 'failed' ? 'failed' : 'succeeded')
      return `<div class="activity-item"><div><code>${h(activity.toolName)}</code><div class="activity-meta">${h(relativeTime(activity.completedAt))} · ${h(new Intl.NumberFormat(locale).format(activity.durationMs))} ms</div></div><span class="outcome ${outcome === 'succeeded' ? '' : outcome === 'failed' ? 'failed' : 'attention'}">${h(outcomes[outcome])}</span></div>`
    }).join('') : `<div class="empty"><div><strong>${h(messages.activity.emptyHeading)}</strong><span>${h(messages.activity.emptyDescription)}</span></div></div>`
    text('connection-note', dashboard.clients.length ? messages.journey.observed : messages.journey.waiting)
    const verified = dashboard.readiness.checks.probe.state === 'probe_verified'
    text('connection-probe', messages.readiness.nextAction[dashboard.readiness.checks.probe.nextAction])
    if (verified) remember('hronaut.home.onboarded', 'true')
    element('home-onboarding').hidden = verified || remember('hronaut.home.onboarded') === 'true' || data.workspaces.mcpTabGroups.length > 0 || data.workspaces.savedTabGroups.length > 0
    element('onboarding-client').dataset.complete = String(dashboard.readiness.checks.initialization.state === 'client_initialized')
    element('onboarding-connection').dataset.complete = String(dashboard.readiness.checks.initialization.state === 'client_initialized')
    element('onboarding-probe').dataset.complete = String(verified)
    element('connections').innerHTML = dashboard.clients.length ? dashboard.clients.map(client => `<div class="connection"><span class="client-icon">${h(client.name.trim().charAt(0))}</span><div><div class="client-name">${h(client.name)}</div><div class="client-meta">${h(client.version ?? messages.connections.versionUnknown)} · ${h(relativeTime(client.lastSeenAt))} · ${h(interpolate(messages.counts.requests, { count: client.requestCount }))}</div></div><span class="connection-state ${client.activeRequests ? 'active' : ''}">${h(client.activeRequests ? messages.connections.active : messages.connections.recent)}</span></div>`).join('') : `<div class="empty"><div><strong>${h(messages.connections.emptyHeading)}</strong><span>${h(messages.connections.emptyDescription)}</span></div></div>`
    renderTools()
  }
  const workspaces = mountWorkspaces(data, api, signal)
  const views = ['workspaces', 'connect', 'overview', 'tools'] as const
  type View = typeof views[number]
  const isView = (value: unknown): value is View => views.includes(value as View)
  let selectedView: View = 'workspaces'
  const savedView = remember('hronaut.home.view.v2')
  if (isView(savedView)) selectedView = savedView
  function selectView(view: View, focus = false): void {
    selectedView = view
    document.documentElement.dataset.homeSelectedView = view
    views.forEach(id => {
      const button = element<HTMLButtonElement>(`home-tab-${id}`)
      button.setAttribute('aria-selected', String(id === view)); button.tabIndex = id === view ? 0 : -1
      element(`home-${id}`).hidden = id !== view
    })
    text('home-view-title', view === 'workspaces' ? library.heading : view === 'connect' ? messages.connect.heading : view === 'overview' ? messages.activity.heading : messages.navigation.tools)
    text('home-view-description', view === 'workspaces' ? library.description : view === 'connect' ? messages.connect.description : view === 'overview' ? messages.activity.description : messages.tools.description)
    if (focus) element(`home-tab-${view}`).focus()
    remember('hronaut.home.view.v2', view)
    if (view === 'connect') {
      const selected = document.querySelector<HTMLElement>(`[data-guide="${selectedGuide}"]`)!
      if (!selected.hidden) agentList.scrollTop += selected.getBoundingClientRect().top - agentList.getBoundingClientRect().top
    }
  }
  views.forEach((view, index) => {
    const button = element(`home-tab-${view}`)
    button.addEventListener('click', () => selectView(view), { signal })
    button.addEventListener('keydown', event => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
      const next = event.key === 'ArrowRight' ? (index + 1) % views.length : event.key === 'ArrowLeft' ? (index + views.length - 1) % views.length : event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1 : -1
      if (next >= 0) { event.preventDefault(); selectView(views[next]!, true) }
    }, { signal })
  })
  document.querySelectorAll<HTMLElement>('[data-open-view]').forEach(button => button.addEventListener('click', () => { if (isView(button.dataset.openView)) selectView(button.dataset.openView, true) }, { signal }))
  const unsubscribe = api?.onShowWorkspaces?.(() => selectView('workspaces'))
  element<HTMLInputElement>('agent-search').addEventListener('input', event => {
    const query = (event.target as HTMLInputElement).value.trim().toLocaleLowerCase(locale)
    let visible = 0
    document.querySelectorAll<HTMLButtonElement>('[data-guide]').forEach(button => { button.hidden = !button.textContent!.toLocaleLowerCase(locale).includes(query); if (!button.hidden) visible++ })
    element('agent-empty').hidden = visible > 0
  }, { signal })
  element('tool-search').addEventListener('input', renderTools, { signal })
  for (const id of ['agent-search', 'tool-search']) element<HTMLInputElement>(id).addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing) return
    const input = event.currentTarget as HTMLInputElement
    input.value = ''; input.dispatchEvent(new Event('input'))
  }, { signal })
  let requestSequence = 0
  async function refresh(): Promise<void> {
    void workspaces.refresh()
    const sequence = ++requestSequence
    try {
      const response = await load('hronaut://home/api/status', { cache: 'no-store', signal })
      if (!response.ok) throw new Error('Local status unavailable')
      const next = await response.json() as HomeDashboard
      if (signal.aborted || sequence !== requestSequence) return
      if (!next || typeof next.version !== 'string' || !Number.isFinite(next.activeRequests) || !Array.isArray(next.clients) || !Array.isArray(next.tools) || !next.readiness) throw new Error('Invalid local status response')
      if (next.presentationRevision !== revision) { window.location.reload(); return }
      update(next)
    } catch {
      if (signal.aborted || sequence !== requestSequence) return
      element('server-state').innerHTML = `<span class="dot error"></span> ${h(messages.status.unavailable)}`
      element('server-state').title = ''; text('active-count', messages.status.unavailable); text('request-count', messages.status.reconnecting); text('connection-note', messages.journey.unavailable)
      text('connection-probe', messages.journey.unavailable)
    }
  }
  async function poll(): Promise<void> { await refresh(); if (!signal.aborted) later(() => void poll(), 2000) }
  function dispose(): void { lifetime.abort(); requestSequence++; timers.forEach(clearTimeout); timers.clear(); unsubscribe?.() }
  window.addEventListener('pagehide', dispose, { once: true, signal })
  renderGuide(); selectView(selectedView); update(dashboard); void poll()
  return { update, refresh, dispose }
}

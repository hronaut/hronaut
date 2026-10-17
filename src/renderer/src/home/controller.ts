import { agentAvatarColorHex } from '../../../shared/agent-presence.js'
import { agentStepKind } from '../../../shared/agent-steps.js'
import { agentStatus, agentStatusText, agentStatusTone } from '../../../shared/agent-status.js'
import type { HomeBootstrap, HomeDashboard, HronautHomeApi } from '../../../shared/home.js'
import { element, escapeText as h, interpolate, messageAt, pluralText, remember, renderStatus } from './dom.js'
import { mountWorkspaces } from './workspaces.js'
import { mountClaudeSetup } from './claude-setup.js'

export function mountHome(data: HomeBootstrap, api: HronautHomeApi, load: typeof fetch = fetch) {
  const { guides, locale } = data
  const messages = data.messages.home
  const library = data.messages.workspaceLibrary
  const mission = messages.mission
  let hasWorkspaces = data.workspaces.mcpTabGroups.length > 0 || data.workspaces.savedTabGroups.length > 0
  let dashboard = data.dashboard
  const revision = dashboard.presentationRevision
  const lifetime = new AbortController()
  const signal = lifetime.signal
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const later = (callback: () => void, delay: number): ReturnType<typeof setTimeout> => {
    const timer = setTimeout(() => { timers.delete(timer); if (!signal.aborted) callback() }, delay)
    timers.add(timer); return timer
  }
  const text = (id: string, value: string | number): void => {
    const target = element(id)
    const next = String(value)
    if (target.textContent !== next) target.textContent = next
  }
  const count = (one: string, other: string, value: number): string => interpolate(value === 1 ? one : other, { count: new Intl.NumberFormat(locale).format(value) })
  let selectedGuide = guides.find(guide => guide.id === remember('hronaut.home.guide'))?.id ?? guides[0]!.id
  // An agent found on this computer becomes the first guide until the person picks one.
  let guideChosen = guides.some(guide => guide.id === remember('hronaut.home.guide'))
  let guideSequence = 0
  let vscodeSequence = 0
  const guideButton = document.querySelector<HTMLButtonElement>('[data-agent-guide]')!
  const vscodeButton = document.querySelector<HTMLButtonElement>('[data-vscode-install]')
  type CopyState = { label: string; title: string; sequence: number; timer?: ReturnType<typeof setTimeout> }
  const copyStates = new Map<HTMLButtonElement, CopyState>()
  let copyFeedbackSequence = 0
  const guideLabel = (): string => interpolate(messages.connect.openGuide, { name: guides.find(guide => guide.id === selectedGuide)!.name })
  const resetCopies = (): void => {
    copyFeedbackSequence++
    copyStates.forEach((state, button) => {
      if (!button.dataset.copyTarget?.startsWith('guide-')) return
      state.sequence++; clearTimeout(state.timer)
      button.textContent = state.label; button.title = state.title
    })
    text('copy-status', '')
  }
  const claudeSetup = mountClaudeSetup(data, api, signal)
  function renderGuide(): void {
    const guide = guides.find(guide => guide.id === selectedGuide)!
    claudeSetup.show(guide.id === 'claude-code')
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
    button.addEventListener('click', () => { selectedGuide = guide.id; guideChosen = true; remember('hronaut.home.guide', guide.id); renderGuide() }, { signal })
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
      const feedbackSequence = ++copyFeedbackSequence
      clearTimeout(state.timer); button.textContent = state.label; button.title = state.title; text('copy-status', '')
      try {
        if (!api?.copyText) throw new Error(messages.copy.unavailable)
        await api.copyText(value)
        if (signal.aborted || sequence !== state.sequence || target.textContent !== value) return
        button.textContent = messages.copy.copied
      } catch (error) {
        if (signal.aborted || sequence !== state.sequence || target.textContent !== value) return
        button.textContent = messages.copy.failed
        button.title = error instanceof Error ? error.message : messages.copy.rejected
        if (feedbackSequence === copyFeedbackSequence) {
          text('copy-status', `${messages.copy.failed} ${messages.copy.rejected}`)
          const selection = window.getSelection(); const range = document.createRange()
          range.selectNodeContents(target); selection?.removeAllRanges(); selection?.addRange(range)
        }
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
    // Each check in words; its typed state stays in the copied diagnostic below. Built as nodes: the pasted tool list
    // feeds this report, so none of it is read as markup.
    const tone = (state: string): 'ok' | 'failed' | 'pending' => /_(?:ready|initialized|advertised|verified)$/u.test(state) ? 'ok' : state === 'blocked' || state.endsWith('_failed') ? 'failed' : 'pending'
    const node = (tag: string, className: string, value = ''): HTMLElement => {
      const created = document.createElement(tag)
      if (className) created.className = className
      created.textContent = value
      return created
    }
    element('readiness-checks').replaceChildren(...Object.entries(report.checks).map(([name, check]) => {
      const state = tone(check.state)
      const dot = node('span', `readiness-dot ${state}`)
      dot.setAttribute('aria-hidden', 'true')
      const title = node('div', 'readiness-title')
      title.append(node('strong', '', messages.readiness.checks[name as keyof typeof report.checks]), node('span', `readiness-tone ${state}`, mission.checks[state]))
      const words = node('div', '')
      words.append(title, node('span', 'readiness-next', messages.readiness.nextAction[check.nextAction]))
      const row = node('div', 'readiness-check')
      row.append(dot, words)
      return row
    }))
    text('readiness-report', JSON.stringify(report, null, 2))
  }
  element('readiness-verify').addEventListener('click', () => {
    observedTools = [...new Set(Array.from(element<HTMLTextAreaElement>('readiness-tool-inventory').value.matchAll(/(?:^|[^a-z0-9_])((?:browser|wallet)_[a-z0-9_]{1,80})(?=$|[^a-z0-9_])/g), match => match[1]!))]
    renderReadiness()
  }, { signal })
  let renderedCatalog = ''
  function renderTools(): void {
    const query = element<HTMLInputElement>('tool-search').value.trim().toLocaleLowerCase(locale)
    const terms = query.split(/\s+/).filter(Boolean)
    const tools = dashboard.tools.filter(tool => {
      const text = `${tool.name} ${tool.category} ${tool.description}`.toLocaleLowerCase(locale)
      return terms.every(term => text.includes(term))
    })
    element('tool-empty').hidden = !query || tools.length > 0
    if (JSON.stringify(tools) === renderedCatalog) return
    renderedCatalog = JSON.stringify(tools)
    const grid = element('tool-grid')
    const focused = grid.contains(document.activeElement) ? document.activeElement as HTMLElement : null
    const existing = new Map(Array.from(grid.children, child => [(child as HTMLElement).dataset.tool, child as HTMLDetailsElement]))
    const names = new Set(tools.map(tool => tool.name))
    for (const [name, child] of existing) if (!names.has(name ?? '')) child.remove()
    tools.forEach((tool, index) => {
      let details = existing.get(tool.name)
      if (!details) {
        details = document.createElement('details'); details.className = 'tool'; details.dataset.tool = tool.name
        const summary = document.createElement('summary')
        const heading = document.createElement('span'); heading.className = 'tool-top'
        const name = document.createElement('code')
        const category = document.createElement('span'); category.className = 'category'
        heading.append(name, category); summary.append(heading)
        details.append(summary, document.createElement('p'))
      }
      details.querySelector('code')!.textContent = tool.name
      details.querySelector('.category')!.textContent = tool.category
      details.querySelector('p')!.textContent = tool.description
      if (grid.children[index] !== details) grid.insertBefore(details, grid.children[index] ?? null)
    })
    if (focused?.isConnected && document.activeElement !== focused) focused.focus()
  }
  const relativeTime = (value: string): string => {
    const elapsed = Date.now() - new Date(value).getTime()
    if (elapsed < 5000) return messages.relativeTime.now
    if (elapsed < 3600000) return interpolate(messages.relativeTime[elapsed < 60000 ? 'seconds' : 'minutes'], { count: new Intl.NumberFormat(locale).format(Math.floor(elapsed / (elapsed < 60000 ? 1000 : 60000))) })
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  }
  /** Agents Home can name: none while the MCP server is not ready. */
  const connectedAgents = () => dashboard.status === 'ready' ? dashboard.agents ?? [] : []
  const greeting = (): string => {
    const hour = new Date().getHours()
    return mission.greeting[hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'afternoon' : 'evening']
  }
  /** "2 agents connected. 1 workspace needs you.", or what workspaces are for while no agent is connected. */
  const summary = (): string => {
    const agents = connectedAgents().length
    const needing = Object.values(dashboard.workspaceActivity ?? {}).filter(activity => activity.state === 'needs-you').length
    const parts = [...(agents ? [pluralText(locale, mission.agentsConnected, agents)] : []), ...(needing ? [pluralText(locale, mission.workspacesNeedYou, needing)] : [])]
    return parts.length ? parts.join(' ') : library.description
  }
  function renderHeading(): void {
    text('home-view-title', selectedView === 'workspaces' ? greeting() : selectedView === 'connect' ? messages.connect.heading : selectedView === 'overview' ? messages.activity.heading : messages.navigation.tools)
    text('home-view-description', selectedView === 'workspaces' ? summary() : selectedView === 'connect' ? messages.connect.description : selectedView === 'overview' ? messages.activity.description : messages.tools.description)
  }
  /** One chip per connected agent: its avatar, its name and what it is doing. */
  let renderedChips = ''
  function renderChips(): void {
    const agents = connectedAgents()
    const list = element('agent-chips')
    list.hidden = !agents.length
    const signature = JSON.stringify(agents.map(agent => [agent.key, agent.name, agent.state, agent.initial, agent.colorIndex]))
    if (signature === renderedChips) return
    renderedChips = signature
    const states = data.messages.shell.agents.states
    list.replaceChildren(...agents.map(agent => {
      const chip = document.createElement('li')
      chip.className = `agent-chip ${agent.state}`
      const avatar = document.createElement('span')
      avatar.className = 'agent-chip-avatar'
      avatar.textContent = agent.initial
      avatar.style.setProperty('--agent-color', agentAvatarColorHex(agent.colorIndex))
      avatar.setAttribute('aria-hidden', 'true')
      const name = document.createElement('strong')
      name.textContent = agent.name || data.messages.shell.agents.unnamed
      const state = document.createElement('span')
      state.className = 'agent-chip-state'
      state.textContent = states[agent.state === 'needs-you' ? 'needsYou' : agent.state]
      chip.append(avatar, name, state)
      return chip
    }))
  }
  function update(next: HomeDashboard): void {
    if (signal.aborted) return
    dashboard = next
    document.documentElement.dataset.theme = dashboard.theme ?? 'light'
    const status = dashboard.status
    const statusLabels = { starting: messages.status.starting, ready: messages.status.online, paused: messages.status.paused, error: messages.status.error }
    // One wording with the toolbar; the server's own state and any error stay under Details.
    const agents = agentStatus(status, dashboard.agents ?? [])
    renderStatus(element('server-state'), agentStatusTone(agents.kind), agentStatusText(agents, data.messages.agentStatus, locale))
    renderChips(); renderHeading()
    workspaces.setLive(dashboard)
    claudeSetup.update(dashboard)
    renderSetupOffer()
    text('server-detail', status === 'error' ? `${statusLabels.error}: ${dashboard.error ?? messages.status.unknownError}` : statusLabels[status])
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
      // Plain words, as in the live activity: what was done, or what was tried when it did not succeed. The tool's name
      // and timing stay in the row's tooltip.
      const technical = `${activity.toolName} · ${new Intl.NumberFormat(locale).format(activity.durationMs)} ms`
      const words = messageAt(data.messages, `shell.${outcome === 'succeeded' ? 'agentCard' : 'agents'}.steps.${agentStepKind(activity.toolName)}`)
      return `<div class="activity-item" title="${h(technical)}"><div><div class="activity-step">${h(words)}</div><div class="activity-meta">${h(relativeTime(activity.completedAt))}</div></div><span class="outcome ${outcome === 'succeeded' ? '' : outcome === 'failed' ? 'failed' : 'attention'}">${h(outcomes[outcome])}</span></div>`
    }).join('') : `<div class="empty"><div><strong>${h(messages.activity.emptyHeading)}</strong><span>${h(messages.activity.emptyDescription)}</span></div></div>`
    text('connection-note', dashboard.clients.length ? messages.journey.observed : messages.journey.waiting)
    const verified = dashboard.readiness.checks.probe.state === 'probe_verified'
    text('connection-probe', messages.readiness.nextAction[dashboard.readiness.checks.probe.nextAction])
    if (verified) remember('hronaut.home.onboarded', 'true')
    renderOnboarding()
    element('onboarding-client').dataset.complete = String(dashboard.readiness.checks.initialization.state === 'client_initialized')
    element('onboarding-connection').dataset.complete = String(dashboard.readiness.checks.initialization.state === 'client_initialized')
    element('onboarding-probe').dataset.complete = String(verified)
    element('connections').innerHTML = dashboard.clients.length ? dashboard.clients.map(client => `<div class="connection"><span class="client-icon">${h(client.name.trim().charAt(0))}</span><div><div class="client-name">${h(client.name)}</div><div class="client-meta">${h(client.version ?? messages.connections.versionUnknown)} · ${h(relativeTime(client.lastSeenAt))} · ${h(interpolate(messages.counts.requests, { count: client.requestCount }))}</div></div><span class="connection-state ${client.activeRequests ? 'active' : ''}">${h(client.activeRequests ? messages.connections.active : messages.connections.recent)}</span></div>`).join('') : `<div class="empty"><div><strong>${h(messages.connections.emptyHeading)}</strong><span>${h(messages.connections.emptyDescription)}</span></div></div>`
    renderTools()
  }
  /** First run: offer to add Hronaut to Claude Code when it is installed and not set up for this address. */
  function renderSetupOffer(): void {
    const offer = document.getElementById('onboarding-claude')
    if (offer) offer.hidden = !claudeSetup.offered()
  }
  document.getElementById('onboarding-claude-setup')?.addEventListener('click', () => {
    selectedGuide = 'claude-code'; guideChosen = true; remember('hronaut.home.guide', selectedGuide)
    selectView('connect'); renderGuide(); claudeSetup.start()
  }, { signal })
  void claudeSetup.refresh().then(state => {
    if (!state || signal.aborted) return
    const found = guides.filter(guide => state.detected.includes(guide.id))
    // Found agents lead the list, each marked, in the guides' own order, without taking keyboard focus away.
    const focused = document.activeElement
    for (const guide of [...found].reverse()) {
      const button = agentList.querySelector<HTMLButtonElement>(`[data-guide="${guide.id}"]`)
      if (!button) continue
      if (!button.querySelector('.agent-found')) {
        const mark = document.createElement('span')
        mark.className = 'agent-found'
        mark.textContent = messages.connect.claudeSetup.found
        button.append(mark)
      }
      agentList.prepend(button)
    }
    if (focused instanceof HTMLElement && focused !== document.activeElement) focused.focus({ preventScroll: true })
    // The first found agent's guide, unless the person picked one before or is already reading the guides.
    if (!guideChosen && selectedView !== 'connect' && found[0] && found[0].id !== selectedGuide) { selectedGuide = found[0].id; renderGuide() }
    renderSetupOffer()
  })
  function renderOnboarding(): void {
    element('home-onboarding').hidden = dashboard.readiness.checks.probe.state === 'probe_verified' || remember('hronaut.home.onboarded') === 'true' || hasWorkspaces
  }
  const workspaces = mountWorkspaces(data, api, signal, state => {
    hasWorkspaces = state.mcpTabGroups.length > 0 || state.savedTabGroups.length > 0
    renderOnboarding()
  })
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
    renderHeading()
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
  document.querySelectorAll<HTMLElement>('[data-open-view]').forEach(button => button.addEventListener('click', () => {
    if (!isView(button.dataset.openView)) return
    // The connection check's link leads to the checks themselves, not to Details folded over them.
    if (button.dataset.openDetails !== undefined) document.querySelector<HTMLDetailsElement>('.overview-details')!.open = true
    selectView(button.dataset.openView, true)
  }, { signal }))
  const unsubscribe = api?.onShowWorkspaces?.(() => selectView('workspaces'))
  element<HTMLInputElement>('agent-search').addEventListener('input', event => {
    const query = (event.target as HTMLInputElement).value.trim().toLocaleLowerCase(locale)
    let visible = 0
    document.querySelectorAll<HTMLButtonElement>('[data-guide]').forEach(button => { button.hidden = !guides.find(guide => guide.id === button.dataset.guide)!.name.toLocaleLowerCase(locale).includes(query); if (!button.hidden) visible++ })
    element('agent-empty').hidden = visible > 0
  }, { signal })
  element('tool-search').addEventListener('input', renderTools, { signal })
  for (const id of ['agent-search', 'tool-search']) element<HTMLInputElement>(id).addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing) return
    const input = event.currentTarget as HTMLInputElement
    input.value = ''; input.dispatchEvent(new Event('input'))
  }, { signal })
  let requestSequence = 0
  // A refresh always reads, and the newest read wins. Main's change notices wait for a read in flight and then read
  // once more, so under a busy agent a slow read is never dropped for a newer one that is dropped in turn.
  let reading: Promise<void> | null = null
  let readAgain = false
  function refresh(): Promise<void> {
    const current = read()
    reading = current
    void current.finally(() => {
      if (reading !== current) return
      reading = null
      if (readAgain && !signal.aborted) { readAgain = false; void refresh() }
    })
    return current
  }
  function refreshSoon(): void {
    if (reading) readAgain = true
    else void refresh()
  }
  async function read(): Promise<void> {
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
      renderStatus(element('server-state'), 'error', messages.status.unavailable)
      text('server-detail', messages.status.reconnecting); text('active-count', messages.status.unavailable); text('request-count', messages.status.reconnecting); text('connection-note', messages.journey.unavailable)
      text('connection-probe', messages.journey.unavailable)
    }
  }
  async function poll(): Promise<void> { await refresh(); if (!signal.aborted) later(() => void poll(), 2000) }
  // Main says when agents change; reading at most every 250 ms keeps a busy agent from flooding Home. Polling stays as
  // the fallback. A hidden Home reads once it is shown again.
  let changeQueued = false
  let changedWhileHidden = false
  const unsubscribeChanges = api?.onChanged?.(() => {
    if (changeQueued || signal.aborted) return
    if (document.hidden) { changedWhileHidden = true; return }
    changeQueued = true
    later(() => { changeQueued = false; refreshSoon() }, 250)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !changedWhileHidden) return
    changedWhileHidden = false
    refreshSoon()
  }, { signal })
  function dispose(): void { lifetime.abort(); requestSequence++; timers.forEach(clearTimeout); timers.clear(); unsubscribe?.(); unsubscribeChanges?.() }
  window.addEventListener('pagehide', dispose, { once: true, signal })
  renderGuide(); selectView(selectedView); update(dashboard); void poll()
  return { update, refresh, dispose }
}

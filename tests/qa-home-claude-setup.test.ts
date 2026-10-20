// @vitest-environment jsdom
// Redesign QA for #874: "Set up Claude Code" on Home. The panel's sequence guard (a late answer never overwrites what
// the person did since), agents found on this computer leading the guides, the first-run offer, and where focus goes
// after Apply.
import { describe, expect, it, vi } from 'vitest'
import type { AgentGuideId } from '../src/shared/agent-guides.js'
import type { ClaudeCodeSetupPreview, ClaudeCodeSetupResult, ClaudeCodeSetupState, HomeSetupState } from '../src/shared/claude-code-setup.js'
import type { HronautHomeApi } from '../src/shared/home.js'
import { agent, baseDashboard, byId, deferred, flush, installHomeHooks, mountTestHome, query, words } from './qa-home-harness.js'

installHomeHooks()

const SETTINGS = '/home/person/.claude.json'
const setupState = (state: ClaudeCodeSetupState | null = 'not-configured', detected: AgentGuideId[] = ['claude-code']): HomeSetupState =>
  ({ detected, ...(state ? { claudeCode: { state, path: SETTINGS } } : {}) })
const plan = (planId: string, before: string | null = null): ClaudeCodeSetupPreview => ({
  planId, path: SETTINGS, before, after: `{ "type": "http", "url": "http://127.0.0.1:47812/mcp", "plan": "${planId}" }`, backupName: `.claude.json.${planId}.bak`
})

/** A setup bridge whose reads answer at once until `hold()`, then wait for the test. */
function setupBridge(initial: HomeSetupState) {
  let current = initial
  let holding = false
  const held: Array<ReturnType<typeof deferred<HomeSetupState>>> = []
  const getSetupState = vi.fn((): Promise<HomeSetupState> => {
    if (!holding) return Promise.resolve(current)
    const next = deferred<HomeSetupState>()
    held.push(next)
    return next.promise
  })
  const prepareClaudeCodeSetup = vi.fn<() => Promise<ClaudeCodeSetupPreview>>().mockResolvedValue(plan('plan-1'))
  const applyClaudeCodeSetup = vi.fn<(planId: string) => Promise<ClaudeCodeSetupResult>>().mockResolvedValue({ outcome: 'applied', backupName: '.claude.json.plan-1.bak' })
  return {
    api: { getSetupState, prepareClaudeCodeSetup, applyClaudeCodeSetup } satisfies Partial<HronautHomeApi>,
    getSetupState, prepareClaudeCodeSetup, applyClaudeCodeSetup, held,
    /** What main reads from now on. */
    set(next: HomeSetupState) { current = next },
    hold() { holding = true },
    release() { holding = false }
  }
}

async function mountSetup(bridge: ReturnType<typeof setupBridge>, options: { authenticationDisabled?: boolean } = {}) {
  const home = mountTestHome({ authenticationDisabled: options.authenticationDisabled ?? true, api: bridge.api })
  await flush()
  return home
}

const guideButton = (id: string) => query<HTMLButtonElement>(`#agent-list [data-guide="${id}"]`)
const chooseGuide = (id: string) => guideButton(id).click()
const panel = () => ({
  shown: !byId('claude-setup').hidden,
  start: byId<HTMLButtonElement>('claude-setup-start').hidden ? null : words(byId('claude-setup-start')),
  startDisabled: byId<HTMLButtonElement>('claude-setup-start').disabled,
  status: words(byId('claude-setup-status')),
  preview: !byId('claude-setup-preview').hidden
})
// The guides and the setup panel are on the Connect view; only the view on screen can take focus.
const openConnect = () => byId<HTMLButtonElement>('home-tab-connect').click()
const startButton = () => byId<HTMLButtonElement>('claude-setup-start')
const applyButton = () => byId<HTMLButtonElement>('claude-setup-apply')
const command = () => byId('guide-code').closest('pre')!
/** The change the panel shows before Apply. */
const change = () => byId('claude-setup-after').closest('pre')!

describe('Agents found on this computer (#874)', () => {
  it('lead the guide list in the guides\' own order, each marked, the rest in their order', async () => {
    const bridge = setupBridge(setupState('not-configured', ['opencode', 'claude-code']))
    const home = await mountSetup(bridge)
    const order = [...byId('agent-list').querySelectorAll<HTMLButtonElement>('[data-guide]')].map(button => button.dataset.guide)
    const guides = home.data.guides.map(guide => guide.id)
    expect(order).toEqual(['claude-code', 'opencode', ...guides.filter(id => id !== 'claude-code' && id !== 'opencode')])
    const marked = [...byId('agent-list').querySelectorAll<HTMLElement>('.agent-found')].map(mark => mark.closest<HTMLElement>('[data-guide]')!.dataset.guide)
    expect(marked).toEqual(['claude-code', 'opencode'])
    expect(words(query('.agent-found', guideButton('opencode')))).toBe('On this computer')
  })

  it.each<[AgentGuideId[], string]>([[['opencode'], 'OpenCode'], [['opencode', 'claude-code'], 'Claude Code'], [[], 'Codex']])(
    'shows the first found agent\'s guide until the person picks one (found %j)', async (detected, name) => {
      await mountSetup(setupBridge(setupState('not-configured', detected)))
      expect(words(byId('guide-name'))).toBe(name)
    }
  )

  it('keeps a guide the person picked on an earlier visit', async () => {
    window.localStorage.setItem('hronaut.home.guide', 'cursor')
    await mountSetup(setupBridge(setupState('not-configured', ['opencode'])))
    expect(words(byId('guide-name'))).toBe('Cursor')
    expect(guideButton('opencode').querySelector('.agent-found')).not.toBeNull()
  })

  it('keeps a guide the person picked before detection answered', async () => {
    const bridge = setupBridge(setupState('not-configured', ['opencode']))
    bridge.hold()
    await mountSetup(bridge)
    chooseGuide('cursor')
    bridge.held[0]!.resolve(setupState('not-configured', ['opencode']))
    await flush()
    expect(words(byId('guide-name'))).toBe('Cursor')
    expect(byId('agent-list').firstElementChild).toBe(guideButton('opencode'))
  })

  it('does not switch the guide while the person is reading the guides', async () => {
    const bridge = setupBridge(setupState('not-configured', ['opencode']))
    bridge.hold()
    await mountSetup(bridge)
    byId<HTMLButtonElement>('home-tab-connect').click()
    bridge.held[0]!.resolve(setupState('not-configured', ['opencode']))
    await flush()
    expect(words(byId('guide-name'))).toBe('Codex')
  })

  it('keeps keyboard focus on a guide that moves to the top', async () => {
    const bridge = setupBridge(setupState('not-configured', ['opencode']))
    bridge.hold()
    await mountSetup(bridge)
    openConnect()
    guideButton('opencode').focus()
    bridge.held[0]!.resolve(setupState('not-configured', ['opencode']))
    await flush()
    expect(byId('agent-list').firstElementChild).toBe(guideButton('opencode'))
    expect(document.activeElement).toBe(guideButton('opencode'))
  })

  it('leaves the list as it is when detection fails', async () => {
    const bridge = setupBridge(setupState())
    bridge.getSetupState.mockRejectedValue(new Error('no access'))
    const home = await mountSetup(bridge)
    expect([...byId('agent-list').querySelectorAll<HTMLButtonElement>('[data-guide]')].map(button => button.dataset.guide)).toEqual(home.data.guides.map(guide => guide.id))
    expect(byId('agent-list').querySelector('.agent-found')).toBeNull()
    expect(byId('home-onboarding').querySelector<HTMLElement>('#onboarding-claude')!.hidden).toBe(true)
  })

  it('still marks found agents while MCP authentication is on, without offering the setup', async () => {
    await mountSetup(setupBridge(setupState(null, ['claude-code'])), { authenticationDisabled: false })
    expect(guideButton('claude-code').querySelector('.agent-found')).not.toBeNull()
    expect(document.getElementById('claude-setup')).toBeNull()
    expect(document.getElementById('onboarding-claude')).toBeNull()
    expect(words(byId('guide-name'))).toBe('Claude Code')
  })
})

describe('The first-run offer (#874)', () => {
  it.each<[ClaudeCodeSetupState | null, boolean]>([
    ['not-configured', true], ['other-address', true], ['configured', false], ['not-found', false], ['unreadable', false], [null, false]
  ])('with Claude Code %s, offers the setup: %s', async (state, offered) => {
    await mountSetup(setupBridge(setupState(state, state === 'not-found' ? [] : ['claude-code'])))
    expect(byId('home-onboarding').hidden).toBe(false)
    expect(byId('onboarding-claude').hidden).toBe(!offered)
  })

  it('opens the Claude Code guide, shows the change and puts focus on it', async () => {
    const bridge = setupBridge(setupState('not-configured', ['codex', 'claude-code']))
    await mountSetup(bridge)
    expect(words(byId('guide-name'))).toBe('Codex')
    expect(words(query('#onboarding-claude span'))).toBe('Claude Code is on this computer. Hronaut can add itself to Claude Code for you.')
    byId<HTMLButtonElement>('onboarding-claude-setup').click()
    expect(byId('home-connect').hidden).toBe(false)
    expect(words(byId('guide-name'))).toBe('Claude Code')
    expect(window.localStorage.getItem('hronaut.home.guide')).toBe('claude-code')
    expect(bridge.prepareClaudeCodeSetup).toHaveBeenCalledTimes(1)
    expect(panel()).toMatchObject({ shown: true, status: 'Reading Claude Code’s settings…', startDisabled: true })
    await flush()
    expect(panel()).toMatchObject({ preview: true, start: null, status: '' })
    // Not Apply: its confirmation makes the change by default, and a held Enter would reach it.
    expect(document.activeElement).toBe(change())
  })

  it('goes away by the next status read once Claude Code is set up', async () => {
    const bridge = setupBridge(setupState())
    await mountSetup(bridge)
    expect(byId('onboarding-claude').hidden).toBe(false)
    bridge.set(setupState('configured'))
    byId<HTMLButtonElement>('onboarding-claude-setup').click()
    await flush()
    applyButton().click()
    await flush()
    // The offer follows Home's own reads (every 2 seconds); the person is on the Connect view meanwhile.
    await vi.advanceTimersByTimeAsync(2000)
    expect(byId('onboarding-claude').hidden).toBe(true)
  })
})

describe('The Set up Claude Code panel (#874)', () => {
  it.each<[ClaudeCodeSetupState, string | null, string]>([
    ['not-configured', 'Set up Claude Code', ''],
    ['other-address', 'Update Claude Code', 'Claude Code points to Hronaut at another address.'],
    ['configured', null, 'Claude Code is already set up for this address.'],
    ['not-found', null, `Claude Code’s settings weren’t found at ${SETTINGS}. Use the command above.`],
    ['unreadable', null, `Hronaut can’t safely change ${SETTINGS}. Use the command above.`]
  ])('with Claude Code %s, offers %s and says "%s"', async (state, start, status) => {
    await mountSetup(setupBridge(setupState(state)))
    expect(words(byId('guide-name'))).toBe('Claude Code')
    expect(panel()).toEqual({ shown: true, start, startDisabled: false, status, preview: false })
  })

  it('says Claude Code is connected once it connects', async () => {
    const home = await mountSetup(setupBridge(setupState('configured')))
    home.show({ ...baseDashboard, agents: [agent('a', 'Claude Code', 'idle')] })
    expect(panel().status).toBe('Claude Code is connected.')
  })

  it('shows only with the Claude Code guide', async () => {
    await mountSetup(setupBridge(setupState()))
    expect(panel().shown).toBe(true)
    chooseGuide('codex')
    expect(panel().shown).toBe(false)
    chooseGuide('claude-code')
    expect(panel().shown).toBe(true)
  })

  it('shows the exact entry, the entry it replaces and the backup, and Cancel drops it', async () => {
    const bridge = setupBridge(setupState('other-address'))
    bridge.prepareClaudeCodeSetup.mockResolvedValue(plan('plan-1', '{ "type": "http", "url": "http://127.0.0.1:9000/mcp" }'))
    await mountSetup(bridge)
    openConnect()
    startButton().click()
    await flush()
    expect(words(byId('claude-setup-intro'))).toBe(`Hronaut will add this server to ${SETTINGS}:`)
    expect(byId('claude-setup-after').textContent).toBe(`"hronaut": ${plan('plan-1').after}`)
    expect(byId('claude-setup-before-wrap').hidden).toBe(false)
    expect(byId('claude-setup-before').textContent).toBe('"hronaut": { "type": "http", "url": "http://127.0.0.1:9000/mcp" }')
    expect(words(byId('claude-setup-backup'))).toBe('A copy of the file is saved first as .claude.json.plan-1.bak.')
    byId<HTMLButtonElement>('claude-setup-cancel').click()
    expect(panel()).toMatchObject({ preview: false, start: 'Update Claude Code', status: 'Nothing was changed.' })
    expect(document.activeElement).toBe(startButton())
    expect(bridge.applyClaudeCodeSetup).not.toHaveBeenCalled()
  })

  it.each<[string, string]>([
    ['claude-code-setup:unreadable', `Hronaut can’t safely change ${SETTINGS}. Use the command above.`],
    ['claude-code-setup:busy', 'Quit Claude Code and try again.'],
    ['something else', 'Couldn’t change Claude Code’s settings. Use the command above.']
  ])('says why preparing failed (%s)', async (message, status) => {
    const bridge = setupBridge(setupState())
    bridge.prepareClaudeCodeSetup.mockRejectedValue(new Error(message))
    await mountSetup(bridge)
    startButton().click()
    await flush()
    expect(panel()).toMatchObject({ preview: false, start: 'Set up Claude Code', startDisabled: false, status })
  })
})

describe('The panel\'s sequence guard (#874)', () => {
  it('drops a change that was being prepared when the panel was hidden and shown again', async () => {
    const bridge = setupBridge(setupState())
    const prepared = deferred<ClaudeCodeSetupPreview>()
    bridge.prepareClaudeCodeSetup.mockReturnValueOnce(prepared.promise)
    await mountSetup(bridge)
    startButton().click()
    expect(panel()).toMatchObject({ status: 'Reading Claude Code’s settings…', startDisabled: true })
    chooseGuide('codex')
    chooseGuide('claude-code')
    await flush()
    expect(panel()).toEqual({ shown: true, start: 'Set up Claude Code', startDisabled: false, status: '', preview: false })
    const focused = document.activeElement
    prepared.resolve(plan('late'))
    await flush()
    expect(panel()).toEqual({ shown: true, start: 'Set up Claude Code', startDisabled: false, status: '', preview: false })
    expect(document.activeElement).toBe(focused)
  })

  it.each(['older first', 'newer first'])('shows only the newest prepared change when answers arrive %s', async order => {
    const bridge = setupBridge(setupState())
    const first = deferred<ClaudeCodeSetupPreview>()
    const second = deferred<ClaudeCodeSetupPreview>()
    bridge.prepareClaudeCodeSetup.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await mountSetup(bridge)
    startButton().click()
    chooseGuide('codex')
    chooseGuide('claude-code')
    await flush()
    startButton().click()
    if (order === 'older first') { first.resolve(plan('older')); await flush(); expect(panel().preview).toBe(false); second.resolve(plan('newer')) }
    else { second.resolve(plan('newer')); await flush(); first.resolve(plan('older')) }
    await flush()
    expect(panel().preview).toBe(true)
    expect(words(byId('claude-setup-backup'))).toBe('A copy of the file is saved first as .claude.json.newer.bak.')
    applyButton().click()
    expect(bridge.applyClaudeCodeSetup).toHaveBeenCalledWith('newer')
  })

  it('never shows an apply answer that arrives after the panel was hidden', async () => {
    const bridge = setupBridge(setupState())
    const applied = deferred<ClaudeCodeSetupResult>()
    bridge.applyClaudeCodeSetup.mockReturnValueOnce(applied.promise)
    await mountSetup(bridge)
    openConnect()
    startButton().click()
    await flush()
    applyButton().click()
    expect(panel().status).toBe('Confirm the change in the dialog…')
    expect(applyButton().disabled).toBe(true)
    expect(byId<HTMLButtonElement>('claude-setup-cancel').disabled).toBe(true)
    chooseGuide('codex')
    chooseGuide('claude-code')
    await flush()
    expect(panel()).toEqual({ shown: true, start: 'Set up Claude Code', startDisabled: false, status: '', preview: false })
    const search = byId('agent-search')
    search.focus()
    applied.resolve({ outcome: 'applied', backupName: '.claude.json.plan-1.bak' })
    await flush()
    expect(panel().status).toBe('')
    expect(document.activeElement).toBe(search)
  })

  it('keeps a setup read that answers late from overwriting a step the person took meanwhile', async () => {
    const bridge = setupBridge(setupState())
    const prepared = deferred<ClaudeCodeSetupPreview>()
    bridge.prepareClaudeCodeSetup.mockReturnValueOnce(prepared.promise)
    await mountSetup(bridge)
    chooseGuide('codex')
    bridge.hold()
    chooseGuide('claude-code')
    startButton().click()
    bridge.held.at(-1)!.resolve(setupState('unreadable'))
    await flush()
    expect(panel()).toMatchObject({ start: 'Set up Claude Code', startDisabled: true, status: 'Reading Claude Code’s settings…' })
    prepared.resolve(plan('plan-1'))
    await flush()
    expect(panel()).toMatchObject({ preview: true, status: '' })
  })
})

describe('Focus after Apply (#874)', () => {
  async function previewed(bridge: ReturnType<typeof setupBridge>) {
    await mountSetup(bridge)
    openConnect()
    startButton().click()
    await flush()
    expect(document.activeElement).toBe(change())
    // The person moves on to Apply once they have read the change.
    applyButton().focus()
  }

  it('waits for the new state, then lands on the command once Claude Code is set up', async () => {
    const bridge = setupBridge(setupState())
    await previewed(bridge)
    bridge.hold()
    applyButton().click()
    await flush()
    expect(bridge.applyClaudeCodeSetup).toHaveBeenCalledWith('plan-1')
    expect(panel().status).toBe('Added. Restart Claude Code and it connects here. Backup: .claude.json.plan-1.bak.')
    // Focus waits for the file's new state.
    expect(document.activeElement).toBe(applyButton())
    bridge.held.at(-1)!.resolve(setupState('configured'))
    await flush()
    expect(panel()).toMatchObject({ start: null, preview: false, status: 'Added. Restart Claude Code and it connects here. Backup: .claude.json.plan-1.bak.' })
    expect(document.activeElement).toBe(command())
  })

  it.each<[string, ClaudeCodeSetupResult | Error, string]>([
    ['cancelled in the dialog', { outcome: 'cancelled' }, 'Nothing was changed.'],
    ['changed meanwhile', new Error('claude-code-setup:changed'), 'Claude Code’s settings changed after you reviewed them. Review the change again.'],
    ['expired', new Error('claude-code-setup:expired'), 'That change expired. Review it again.']
  ])('lands on the button when the change was %s', async (_name, answer, status) => {
    const bridge = setupBridge(setupState())
    if (answer instanceof Error) bridge.applyClaudeCodeSetup.mockRejectedValue(answer)
    else bridge.applyClaudeCodeSetup.mockResolvedValue(answer)
    await previewed(bridge)
    applyButton().click()
    await flush()
    expect(panel()).toMatchObject({ start: 'Set up Claude Code', preview: false, status })
    expect(document.activeElement).toBe(startButton())
  })

  it('says the file changed again right after, with the backup, and lands on the button', async () => {
    const bridge = setupBridge(setupState())
    bridge.applyClaudeCodeSetup.mockResolvedValue({ outcome: 'overwritten', backupName: 'backup-2' })
    await previewed(bridge)
    applyButton().click()
    await flush()
    expect(panel().status).toBe('Hronaut made the change, but the file changed again right after, probably by Claude Code. Quit Claude Code and set it up again. Backup: backup-2.')
    expect(document.activeElement).toBe(startButton())
  })

  it('leaves focus where the person moved it while the dialog was open', async () => {
    const bridge = setupBridge(setupState())
    const applied = deferred<ClaudeCodeSetupResult>()
    bridge.applyClaudeCodeSetup.mockReturnValueOnce(applied.promise)
    await previewed(bridge)
    applyButton().click()
    const search = byId('agent-search')
    search.focus()
    applied.resolve({ outcome: 'applied', backupName: 'backup-3' })
    await flush()
    expect(panel().status).toBe('Added. Restart Claude Code and it connects here. Backup: backup-3.')
    expect(document.activeElement).toBe(search)
  })

  it('does not move focus for an Apply the person has already moved on from', async () => {
    const bridge = setupBridge(setupState())
    await previewed(bridge)
    bridge.hold()
    bridge.prepareClaudeCodeSetup.mockResolvedValue(plan('plan-2'))
    applyButton().click()
    await flush()
    // The person starts again before the new state is read.
    startButton().click()
    await flush()
    expect(document.activeElement).toBe(change())
    bridge.held.at(-1)!.resolve(setupState('configured'))
    await flush()
    expect(panel().preview).toBe(true)
    expect(document.activeElement).toBe(change())
  })
})

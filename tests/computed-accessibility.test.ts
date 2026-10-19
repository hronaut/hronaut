import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import {
  ComputedAccessibilityReader,
  projectComputedAccessibility,
  withinBound
} from '../src/main/browser/computed-accessibility/computed-accessibility.js'
import { COMPUTED_ACCESSIBILITY_LIMITS, COMPUTED_ACCESSIBILITY_STATES } from '../src/shared/computed-accessibility.js'

const ORIGIN = 'http://localhost:3000'
const CANARIES = ['CANARY_NAME', 'CANARY_VALUE', 'CANARY_DESCRIPTION', 'CANARY_RELATED', 'CANARY_SOURCE']

/** A Chromium answer for one spin button, with every text field Chromium also sends filled with canaries. */
function spinbutton(overrides: Record<string, unknown> = {}) {
  return {
    nodeId: '42',
    backendDOMNodeId: 7,
    ignored: false,
    role: { type: 'role', value: 'spinbutton' },
    chromeRole: { type: 'internalRole', value: 156 },
    name: { type: 'computedString', value: 'CANARY_NAME', sources: [{ type: 'relatedElement', attribute: 'aria-labelledby', value: { type: 'computedString', value: 'CANARY_SOURCE' } }] },
    description: { type: 'computedString', value: 'CANARY_DESCRIPTION' },
    value: { type: 'string', value: 'CANARY_VALUE' },
    properties: [
      { name: 'invalid', value: { type: 'token', value: 'false' } },
      { name: 'focusable', value: { type: 'booleanOrUndefined', value: true } },
      { name: 'required', value: { type: 'boolean', value: false } },
      { name: 'valuetext', value: { type: 'string', value: 'CANARY_VALUE' } },
      { name: 'valuemax', value: { type: 'number', value: 10 } },
      { name: 'labelledby', value: { type: 'nodeList', relatedNodes: [{ backendDOMNodeId: 3, idref: 'label', text: 'CANARY_RELATED' }] } }
    ],
    parentId: '41',
    childIds: ['43'],
    ...overrides
  }
}

describe('computed accessibility projection', () => {
  it('keeps the role, reason codes and allowlisted states, and nothing that carries page text', () => {
    const report = projectComputedAccessibility(spinbutton())
    expect(report).toEqual({
      role: 'spinbutton',
      ignored: false,
      ignoredReasons: [],
      otherIgnoredReasons: 0,
      states: { invalid: 'false', focusable: true, required: false },
      notReported: Object.keys(COMPUTED_ACCESSIBILITY_STATES).filter(state => !['invalid', 'focusable', 'required'].includes(state)),
      unsupported: []
    })
    const text = JSON.stringify(report)
    for (const canary of CANARIES) expect(text).not.toContain(canary)
    expect(text).not.toMatch(/valuetext|valuemax|labelledby|156|"42"|"41"/)
  })

  it('keeps false, not reported and unsupported apart', () => {
    const report = projectComputedAccessibility(spinbutton({
      properties: [
        { name: 'expanded', value: { type: 'booleanOrUndefined', value: false } },
        { name: 'pressed', value: { type: 'tristate', value: 'mixed' } },
        { name: 'checked', value: { type: 'tristate', value: 'true' } },
        { name: 'selected', value: { type: 'string', value: 'CANARY_VALUE' } },
        { name: 'level', value: { type: 'integer', value: 2 } },
        { name: 'hasPopup', value: { type: 'token', value: 'CANARY VALUE with spaces' } }
      ]
    }))
    expect(report.states).toEqual({ expanded: false, pressed: 'mixed', checked: true, level: 2 })
    expect(report.unsupported).toEqual(['selected', 'hasPopup'])
    expect(report.notReported).toContain('readonly')
    expect(report.notReported).not.toContain('expanded')
    expect(JSON.stringify(report)).not.toContain('CANARY')
  })

  it('reports allowlisted ignored reasons by name and only counts the rest, without their related nodes', () => {
    const report = projectComputedAccessibility({
      backendDOMNodeId: 7,
      ignored: true,
      role: { value: 'none' },
      ignoredReasons: [
        { name: 'ariaHiddenSubtree', value: { type: 'idref', relatedNodes: [{ backendDOMNodeId: 3, idref: 'CANARY_RELATED', text: 'CANARY_RELATED' }] } },
        { name: 'ariaHiddenSubtree', value: { type: 'boolean', value: true } },
        { name: 'someFutureReason', value: { type: 'boolean', value: true } },
        { name: 'CANARY_NAME' }
      ]
    })
    expect(report).toMatchObject({ role: 'none', ignored: true, ignoredReasons: ['ariaHiddenSubtree'], otherIgnoredReasons: 2 })
    expect(JSON.stringify(report)).not.toContain('CANARY')
  })

  it('replaces a role that is not a plain token', () => {
    expect(projectComputedAccessibility({ role: { value: 'CANARY NAME <b>' } }).role).toBe('unknown')
    expect(projectComputedAccessibility({ role: { value: 'x'.repeat(65) } }).role).toBe('unknown')
    expect(projectComputedAccessibility({}).role).toBe('unknown')
  })

  it('accepts names, descriptions and values within what the page count saw, with room for separators', () => {
    const bound = { chars: 10, elements: 2 }
    expect(withinBound({ name: { value: 'n'.repeat(10 + 4 + 256) } }, bound)).toBe(true)
    expect(withinBound({ name: { value: 'n'.repeat(200) }, value: { value: 'v'.repeat(71) } }, bound)).toBe(false)
  })
})

type Answer = (params: Record<string, unknown> | undefined) => unknown

/** A page whose debugger answers the reader's commands; answers can be replaced per method. */
function page() {
  const sent: Array<{ method: string; params?: Record<string, unknown> }> = []
  const frame = { id: 'main', loaderId: 'loader-1', url: `${ORIGIN}/form` }
  const answers = new Map<string, Answer>([
    ['Page.getFrameTree', () => ({ frameTree: { frame: { ...frame } } })],
    ['DOM.getDocument', () => ({ root: { nodeId: 1 } })],
    ['DOM.querySelectorAll', () => ({ nodeIds: [5] })],
    ['DOM.describeNode', () => ({ node: { backendNodeId: 7, nodeType: 1 } })],
    ['Page.createIsolatedWorld', () => ({ executionContextId: 9 })],
    ['DOM.resolveNode', () => ({ object: { objectId: 'object-1' } })],
    ['Runtime.callFunctionOn', () => ({ result: { value: { chars: 40, elements: 3 } } })],
    ['Accessibility.getPartialAXTree', () => ({ nodes: [spinbutton()] })]
  ])
  const debuggerApi = {
    isAttached: () => true,
    sendCommand: (method: string, params?: Record<string, unknown>) => {
      sent.push({ method, params })
      const answer = answers.get(method)
      try {
        return Promise.resolve(answer ? answer(params) : {})
      } catch (error) {
        return Promise.reject(error)
      }
    }
  }
  const webContents = { debugger: debuggerApi, isDestroyed: () => false } as unknown as WebContents
  const tab = { id: 'tab-1', url: frame.url, observationGeneration: 1, webContents }
  return { tab, frame, sent, methods: () => sent.map(command => command.method), answer: (method: string, answer: Answer) => { answers.set(method, answer) } }
}

function reader(options: { conflict?: string; keepDomEnabled?: boolean; current?: () => boolean } = {}) {
  return new ComputedAccessibilityReader<ReturnType<typeof page>['tab']>({
    isCurrent: () => options.current?.() ?? true,
    withDebugger: async (_tab, operation) => await operation(),
    conflict: () => options.conflict,
    keepDomEnabled: () => options.keepDomEnabled ?? false
  })
}

const allowed = { assertCurrent: () => undefined }

describe('computed accessibility reader', () => {
  it('counts the element\'s text in an isolated world before asking Chromium, then cleans up', async () => {
    const fake = page()
    const report = await reader().read(fake.tab, { selector: '#quantity' }, allowed)
    expect(report).toMatchObject({ tabId: 'tab-1', source: 'chromium-accessibility-tree', role: 'spinbutton', states: { required: false } })
    expect(report.caveats.length).toBeGreaterThan(0)
    expect(JSON.stringify(report)).not.toMatch(/CANARY/)
    const methods = fake.methods()
    expect(methods.indexOf('Runtime.callFunctionOn')).toBeLessThan(methods.indexOf('Accessibility.getPartialAXTree'))
    expect(fake.sent.find(command => command.method === 'Page.createIsolatedWorld')?.params).toMatchObject({ frameId: 'main', grantUniveralAccess: false })
    expect(fake.sent.find(command => command.method === 'DOM.resolveNode')?.params).toMatchObject({ backendNodeId: 7, executionContextId: 9 })
    expect(fake.sent.find(command => command.method === 'Accessibility.getPartialAXTree')?.params).toEqual({ backendNodeId: 7, fetchRelatives: false })
    expect(methods.slice(-3)).toEqual(['Runtime.releaseObjectGroup', 'Accessibility.disable', 'DOM.disable'])
  })

  it('resolves a ref through the attribute snapshots set, escaped character by character', async () => {
    const fake = page()
    await reader().read(fake.tab, { ref: 'e1"]' }, allowed)
    expect(fake.sent.find(command => command.method === 'DOM.querySelectorAll')?.params?.selector).toBe('[data-hronaut-ref="\\65 \\31 \\22 \\5d "]')
  })

  it('refuses an element whose text exceeds the limit without asking Chromium', async () => {
    for (const counted of [{ chars: COMPUTED_ACCESSIBILITY_LIMITS.maxTextChars + 1, elements: 1 }, { chars: 1, elements: COMPUTED_ACCESSIBILITY_LIMITS.maxElements + 1 }]) {
      const fake = page()
      fake.answer('Runtime.callFunctionOn', () => ({ result: { value: counted } }))
      await expect(reader().read(fake.tab, { selector: '#big' }, allowed)).rejects.toThrow(/exceed 100,000 characters or 5,000 elements/)
      expect(fake.methods()).not.toContain('Accessibility.getPartialAXTree')
      expect(fake.methods().slice(-3)).toEqual(['Runtime.releaseObjectGroup', 'Accessibility.disable', 'DOM.disable'])
    }
  })

  it('refuses an answer larger than the page count allows, as from a closed shadow root', async () => {
    const fake = page()
    fake.answer('Accessibility.getPartialAXTree', () => ({ nodes: [spinbutton({ name: { value: 'CANARY_NAME'.repeat(1_000) } })] }))
    const failure = await reader().read(fake.tab, { selector: '#closed' }, allowed).catch((error: Error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toMatch(/closed shadow root/)
    expect((failure as Error).message).not.toContain('CANARY')
  })

  it('refuses a count it cannot read', async () => {
    const fake = page()
    fake.answer('Runtime.callFunctionOn', () => ({ result: { value: { chars: -1, elements: 'many' } } }))
    await expect(reader().read(fake.tab, { selector: '#x' }, allowed)).rejects.toThrow(/could not count/)
    expect(fake.methods()).not.toContain('Accessibility.getPartialAXTree')
  })

  it('requires exactly one element in the top-level document', async () => {
    for (const nodeIds of [[], [5, 6]]) {
      const fake = page()
      fake.answer('DOM.querySelectorAll', () => ({ nodeIds }))
      await expect(reader().read(fake.tab, { selector: 'button' }, allowed)).rejects.toThrow(nodeIds.length ? /more than one/ : /No element/)
      expect(fake.methods()).not.toContain('Accessibility.getPartialAXTree')
    }
    await expect(reader().read(page().tab, {}, allowed)).rejects.toThrow(/exactly one of ref or selector/)
    await expect(reader().read(page().tab, { ref: 'e1', selector: '#a' }, allowed)).rejects.toThrow(/exactly one of ref or selector/)
  })

  it('reports nothing when Chromium answers for another node', async () => {
    const fake = page()
    fake.answer('Accessibility.getPartialAXTree', () => ({ nodes: [spinbutton({ backendDOMNodeId: 8 })] }))
    await expect(reader().read(fake.tab, { selector: '#x' }, allowed)).rejects.toThrow(/no accessibility node/)
  })

  it('reports nothing when the element or the document changed during the read', async () => {
    const replaced = page()
    let finds = 0
    replaced.answer('DOM.querySelectorAll', () => ({ nodeIds: [++finds === 1 ? 5 : 6] }))
    await expect(reader().read(replaced.tab, { selector: '#x' }, allowed)).rejects.toThrow(/changed/)

    const navigated = page()
    let frames = 0
    navigated.answer('Page.getFrameTree', () => ({ frameTree: { frame: { id: 'main', loaderId: ++frames === 1 ? 'loader-1' : 'loader-2' } } }))
    await expect(reader().read(navigated.tab, { selector: '#x' }, allowed)).rejects.toThrow(/changed/)

    const paused = page()
    paused.answer('Accessibility.getPartialAXTree', () => { paused.tab.observationGeneration++; return { nodes: [spinbutton()] } })
    await expect(reader().read(paused.tab, { selector: '#x' }, allowed)).rejects.toThrow(/changed/)
  })

  it('checks the authority before asking Chromium and before returning', async () => {
    const fake = page()
    const assertCurrent = vi.fn()
    await reader().read(fake.tab, { selector: '#x' }, { assertCurrent })
    expect(assertCurrent.mock.calls.length).toBeGreaterThanOrEqual(4)

    const revoked = page()
    let calls = 0
    const failure = await reader().read(revoked.tab, { selector: '#x' }, {
      assertCurrent: () => { if (++calls > 3) throw new Error('Capability revoked') }
    }).catch((error: Error) => error)
    expect((failure as Error).message).toBe('Capability revoked')
    expect(revoked.methods()).toContain('Accessibility.getPartialAXTree')
    expect(revoked.methods().slice(-3)).toEqual(['Runtime.releaseObjectGroup', 'Accessibility.disable', 'DOM.disable'])
  })

  it('refuses while another debugger use needs the DOM bindings, and keeps the DOM domain for one that needs it', async () => {
    const blocked = page()
    await expect(reader({ conflict: 'Clear the CSS state preview before reading computed accessibility' }).read(blocked.tab, { selector: '#x' }, allowed))
      .rejects.toThrow(/CSS state preview/)
    expect(blocked.sent).toEqual([])

    const kept = page()
    await reader({ keepDomEnabled: true }).read(kept.tab, { selector: '#x' }, allowed)
    expect(kept.methods()).not.toContain('DOM.disable')
  })

  it('reads only HTTP(S) pages of the current tab', async () => {
    const fake = page()
    fake.tab.url = 'file:///tmp/form.html'
    await expect(reader().read(fake.tab, { selector: '#x' }, allowed)).rejects.toThrow(/HTTP\(S\)/)
    await expect(reader({ current: () => false }).read(page().tab, { selector: '#x' }, allowed)).rejects.toThrow(/changed/)
  })
})

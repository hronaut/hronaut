import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { sizingInputsSettlementScript, sizingInputsSource } from '../src/main/browser/element-sizing-inputs.js'
import { BROWSER_TOOL_CATALOG } from '../src/main/mcp/tool-catalog.js'
import { registerBrowserElementInspect } from '../src/main/mcp/tools/browser-element-inspect/index.js'
import { flexContainerContext, normalizeFlexContainer } from '../src/shared/element-flex-container.js'
import { formatElementInspectionForAgent, normalizeElementInspection } from '../src/shared/element-inspection.js'

type Style = Record<string, string>

const FLEX_PARENT: Style = {
  display: 'flex', flexDirection: 'row', flexWrap: 'wrap', rowGap: '8px', columnGap: '12.5%', direction: 'ltr', writingMode: 'horizontal-tb',
  paddingLeft: '10px', paddingRight: '6px', paddingTop: '4px', paddingBottom: '0px', position: 'static'
}
const ITEM: Style = { display: 'block', position: 'static' }

/** A parent and child whose computed styles are the given records; only these two nodes exist. */
function fakeTree(parentStyle: Style = FLEX_PARENT, itemStyle: Style = ITEM, parentFields: Record<string, unknown> = {}, itemFields: Record<string, unknown> = {}) {
  const parent = { localName: 'div', namespaceURI: 'http://www.w3.org/1999/xhtml', shadowRoot: null, clientWidth: 300, clientHeight: 120, ...parentFields }
  const element = { parentElement: parent as unknown, isConnected: true, getRootNode: () => document, checkVisibility: () => true, ...itemFields }
  const document: Record<string, unknown> = { documentElement: {}, body: {}, compatMode: 'CSS1Compat' }
  const styles = new Map<unknown, Style>([[parent, parentStyle], [element, itemStyle]])
  const getComputedStyle = (node: unknown) => {
    const style = styles.get(node)
    if (!style) throw new Error('Read a node other than the item and its parent')
    return { ...style, getPropertyValue: (property: string) => property === 'flex-grow' ? '1' : 'auto' }
  }
  return { parent, element, document, getComputedStyle }
}

/** Runs the serialized reader the way the isolated world does: from its source text, with no imports. */
function readInPage(tree: ReturnType<typeof fakeTree>): unknown {
  return runInNewContext(`(${flexContainerContext.toString()})(element)`, { element: tree.element, document: tree.document, getComputedStyle: tree.getComputedStyle })
}

describe('flex container context', () => {
  it('reads the parent flex inputs and its content size from source text alone', () => {
    const raw = readInPage(fakeTree())
    expect(raw).toEqual({
      status: 'observed', display: 'flex', flexDirection: 'row', flexWrap: 'wrap', rowGap: '8px', columnGap: '12.5%',
      direction: 'ltr', writingMode: 'horizontal-tb', contentWidth: 284, contentHeight: 116
    })
    expect(normalizeFlexContainer(raw)).toEqual(raw)
    expect(readInPage(fakeTree({ ...FLEX_PARENT, display: 'inline-flex', flexDirection: 'column-reverse', writingMode: 'vertical-rl', direction: 'rtl' })))
      .toMatchObject({ status: 'observed', display: 'inline-flex', flexDirection: 'column-reverse', writingMode: 'vertical-rl', direction: 'rtl' })
  })

  it.each([
    ['no-parent', () => { const tree = fakeTree(); tree.element.parentElement = null; return tree }],
    ['shadow-host-or-custom-element', () => fakeTree(FLEX_PARENT, ITEM, { shadowRoot: {} })],
    ['shadow-host-or-custom-element', () => fakeTree(FLEX_PARENT, ITEM, { localName: 'my-toolbar' })],
    ['native-or-anonymous-container', () => fakeTree(FLEX_PARENT, ITEM, { localName: 'button' })],
    ['native-or-anonymous-container', () => fakeTree(FLEX_PARENT, ITEM, { localName: 'details' })],
    ['native-or-anonymous-container', () => fakeTree(FLEX_PARENT, ITEM, { localName: 'fieldset' })],
    ['native-or-anonymous-container', () => fakeTree(FLEX_PARENT, ITEM, { localName: 'select' })],
    ['native-or-anonymous-container', () => fakeTree(FLEX_PARENT, ITEM, { localName: 'g', namespaceURI: 'http://www.w3.org/2000/svg' })],
    ['item-not-rendered', () => fakeTree(FLEX_PARENT, ITEM, {}, { checkVisibility: () => false })],
    ['item-not-rendered', () => fakeTree(FLEX_PARENT, { display: 'none', position: 'static' })],
    ['item-display-contents', () => fakeTree(FLEX_PARENT, { display: 'contents', position: 'static' })],
    ['item-out-of-flow', () => fakeTree(FLEX_PARENT, { display: 'block', position: 'absolute' })],
    ['item-out-of-flow', () => fakeTree(FLEX_PARENT, { display: 'block', position: 'fixed' })],
    ['not-flex-container', () => fakeTree({ ...FLEX_PARENT, display: 'block' })],
    ['not-flex-container', () => fakeTree({ ...FLEX_PARENT, display: 'contents' })],
    ['not-flex-container', () => fakeTree({ ...FLEX_PARENT, display: 'grid' })]
  ] as const)('reports %s instead of another box', (reason, tree) => {
    expect(normalizeFlexContainer(readInPage(tree()))).toEqual({ status: 'unavailable', reason })
  })

  it('leaves the size unknown where the browser reports the viewport size instead of the parent box', () => {
    const root = fakeTree()
    root.document.documentElement = root.parent
    expect(readInPage(root)).toMatchObject({ status: 'observed', contentWidth: null, contentHeight: null })
    const quirks = fakeTree()
    Object.assign(quirks.document, { body: quirks.parent, compatMode: 'BackCompat' })
    expect(readInPage(quirks)).toMatchObject({ status: 'observed', contentWidth: null, contentHeight: null })
    const standards = fakeTree()
    standards.document.body = standards.parent
    expect(readInPage(standards)).toMatchObject({ contentWidth: 284, contentHeight: 116 })
  })

  it('sends only CSS keywords and lengths out of the page', () => {
    expect(readInPage(fakeTree({ ...FLEX_PARENT, rowGap: 'calc(1px + 2%)', writingMode: 'PRIVATE MODE', columnGap: 'normal' })))
      .toMatchObject({ rowGap: null, writingMode: null, columnGap: 'normal' })
  })

  it('keeps unsupported computed values null and never passes page strings through', () => {
    const report = normalizeFlexContainer({
      status: 'observed', display: 'flex', flexDirection: 'PRIVATE', flexWrap: ['wrap'], rowGap: 'calc(1px + 2%)', columnGap: '1e9999px',
      direction: 'sideways', writingMode: 'PRIVATE_MODE', contentWidth: -1, contentHeight: Number.POSITIVE_INFINITY, extra: 'PRIVATE_EXTRA'
    })
    expect(report).toEqual({
      status: 'observed', display: 'flex', flexDirection: null, flexWrap: null, rowGap: null, columnGap: null,
      direction: null, writingMode: null, contentWidth: null, contentHeight: null
    })
    expect(normalizeFlexContainer({ status: 'observed', display: 'grid' })).toEqual({ status: 'unavailable', reason: 'not-flex-container' })
    expect(normalizeFlexContainer({ status: 'unavailable', reason: 'PRIVATE' })).toEqual({ status: 'unavailable', reason: 'not-flex-container' })
    expect(normalizeFlexContainer({ status: 'observed', display: 'flex', rowGap: 'normal', contentWidth: 12.3456 })).toMatchObject({ rowGap: 'normal', contentWidth: 12.35 })
    // Padding that is not a plain pixel length leaves the size unknown rather than guessed.
    expect(readInPage(fakeTree({ ...FLEX_PARENT, paddingLeft: 'auto' }))).toMatchObject({ contentWidth: Number.NaN })
    expect(normalizeFlexContainer(readInPage(fakeTree({ ...FLEX_PARENT, paddingLeft: 'auto' })))).toMatchObject({ contentWidth: null, contentHeight: 116 })
  })

  it('adds the context to the inspection and its agent text only when it was read', () => {
    const input = { tabId: 'tab', title: '', url: 'https://example.test', raw: { selector: '#target', tag: 'div', sizingInputs: { 'flex-grow': 1 } } }
    expect(normalizeElementInspection(input)).not.toHaveProperty('flexContainer')
    const report = normalizeElementInspection({ ...input, raw: { ...input.raw, flexContainer: { status: 'unavailable', reason: 'item-out-of-flow' } } })
    expect(report.flexContainer).toEqual({ status: 'unavailable', reason: 'item-out-of-flow' })
    expect(formatElementInspectionForAgent(report)).toContain('Parent flex container: {"status":"unavailable","reason":"item-out-of-flow"} (immediate parent only')
    expect(formatElementInspectionForAgent(report)).not.toContain('parent context')
    expect(formatElementInspectionForAgent(normalizeElementInspection(input))).toContain('parent context')
  })

  it('refuses publication when the element moved to another parent after it was read', () => {
    for (const includeFlexContainer of [true, false]) {
      const tree = fakeTree()
      const token = `token-${includeFlexContainer}`
      const scope = {
        element: tree.element, document: tree.document, getComputedStyle: tree.getComputedStyle, setTimeout, clearTimeout,
        __hronautSizingInputs: new Map()
      }
      const raw = runInNewContext(`const sizingLookup=()=>[element];${sizingInputsSource(token, includeFlexContainer)}`, scope) as Record<string, unknown>
      expect(raw.sizingInputs).toMatchObject({ 'flex-grow': 1 })
      expect('flexContainer' in raw).toBe(includeFlexContainer)
      tree.element.parentElement = { localName: 'section', shadowRoot: null }
      // Only the flex container report depends on the parent, so only it is refused.
      expect(runInNewContext(sizingInputsSettlementScript(token), scope)).toBe(!includeFlexContainer)
      expect(scope.__hronautSizingInputs.size).toBe(0)
    }
  })
})

it('describes the parent context and its limits in the tool catalog', () => {
  const description = BROWSER_TOOL_CATALOG.find(tool => tool.name === 'browser_element_inspect')!.description
  expect(description).toContain('Optional includeFlexContainer adds those inputs plus the immediate parent flex container')
  expect(description).toContain('No siblings, ancestors beyond the parent or causal claim.')
})

it('settles a flex container inspection like sizing inputs: activity waits for the result and the view is not moved', () => {
  let options: { settlement: (input: Record<string, unknown>) => { deferActivity: (finish: () => void) => boolean }; preservesPresentation: (input: Record<string, unknown>) => boolean } | undefined
  registerBrowserElementInspect({
    manager: {},
    tabTool: (_name: string, callback: unknown) => callback,
    registerWorkspaceTool: (_name: string, _config: unknown, _callback: unknown, registered: typeof options) => { options = registered }
  } as never)
  for (const input of [{ includeFlexContainer: true }, { includeSizingInputs: true }]) {
    expect(options!.settlement(input).deferActivity(() => undefined), JSON.stringify(input)).toBe(true)
    expect(options!.preservesPresentation(input), JSON.stringify(input)).toBe(true)
  }
  expect(options!.settlement({}).deferActivity(() => undefined)).toBe(false)
  expect(options!.preservesPresentation({})).toBe(false)
})

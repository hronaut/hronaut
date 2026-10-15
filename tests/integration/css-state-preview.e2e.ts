import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

interface CssStatePreviewReport {
  status: 'active' | 'inactive' | 'reset-uncertain'
  preview?: { states: string[]; selector: string; remainingMs: number }
  lastEnded?: { reason: string; clean: boolean }
  caveats: string[]
}

const RED = 'rgb(255, 0, 0)'
const BLUE = 'rgb(0, 0, 255)'
const GREEN = 'rgb(0, 128, 0)'
const WHITE = 'rgb(255, 255, 255)'

test('forces hover and active styling on one element without sending input and always ends it', async ({ capabilities, appWindow }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const call = async (name: string, args: Record<string, unknown>) => (
    await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
  )
  const evaluate = async (script: string) => {
    const result = await call('browser_evaluate', { script })
    expect(result.isError, text(result)).not.toBe(true)
    return text(result)
  }
  const preview = async (args: Record<string, unknown>) => {
    const result = await call('browser_css_state_preview', args)
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)) as CssStatePreviewReport
  }
  const setUp = () => evaluate(`(() => {
    document.getElementById('preview-fixture')?.remove();
    const root = document.createElement('section');
    root.id = 'preview-fixture';
    root.innerHTML = '<style>.card .reveal{color:${BLUE}}.card:hover .reveal{color:${RED}}#press{background-color:${WHITE}}#press:active{background-color:${GREEN}}</style>'
      + '<div class="card" style="width:160px;height:60px"><span class="reveal">Details</span></div><button id="press" type="button">Press</button><input id="focus-anchor">';
    document.body.append(root);
    window.__previewEvents = 0;
    for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointerdown', 'mousedown', 'click', 'focusin']) {
      root.addEventListener(type, () => { window.__previewEvents += 1 }, true);
    }
    document.getElementById('focus-anchor').focus();
    window.__previewEvents = 0;
    return true;
  })()`)
  const revealColor = () => evaluate(`getComputedStyle(document.querySelector('.card .reveal')).color`)
  const pressBackground = () => evaluate(`getComputedStyle(document.querySelector('#press')).backgroundColor`)

  await setUp()
  expect(await revealColor()).toBe(BLUE)

  const started = await preview({ action: 'set', selector: '.card', states: ['hover'] })
  expect(started).toMatchObject({ status: 'active', preview: { states: ['hover'], selector: '.card' } })
  expect(started.caveats.join(' ')).toContain('No pointer, click, focus or keyboard events')
  expect(await revealColor()).toBe(RED)
  expect(await evaluate(`String(window.__previewEvents)`)).toBe('0')
  expect(await evaluate(`document.activeElement.id`)).toBe('focus-anchor')
  expect(await evaluate(`document.querySelector('.card').getAttribute('class')`)).toBe('card')

  // Everything captured while the state is forced says so.
  const screenshot = await call('browser_screenshot', {})
  expect(screenshot.isError, text(screenshot)).not.toBe(true)
  expect(JSON.parse(text(screenshot))).toMatchObject({ cssStatePreview: { states: ['hover'], selector: '.card' } })
  const inspected = await call('browser_element_inspect', { selector: '.card .reveal', cssProperties: ['color'] })
  expect(inspected.isError, text(inspected)).not.toBe(true)
  expect(JSON.parse(text(inspected))).toMatchObject({
    cssStatePreview: { states: ['hover'], selector: '.card' },
    // Collecting provenance would reset this session's DOM bindings and silently drop the override.
    cssProvenance: { status: 'unavailable', reason: 'debugger-in-use' }
  })
  expect(await revealColor()).toBe(RED)
  const baseline = await call('browser_visual_compare', { action: 'set-baseline' })
  expect(baseline.isError, text(baseline)).not.toBe(true)
  expect(JSON.parse(text(baseline))).toMatchObject({ cssStatePreview: { selector: '.card' } })
  await call('browser_visual_compare', { action: 'clear' })

  const coverage = await call('browser_code_coverage', { action: 'start', reload: false })
  expect(coverage.isError).toBe(true)
  expect(text(coverage)).toContain('Clear the CSS state preview')

  expect(await preview({ action: 'clear' })).toMatchObject({ status: 'inactive', lastEnded: { reason: 'cleared', clean: true } })
  expect(await revealColor()).toBe(BLUE)
  const unmarked = await call('browser_screenshot', {})
  expect(unmarked.content.some(item => item.type === 'text' && item.text.includes('cssStatePreview'))).toBe(false)

  for (const [args, message] of [
    [{ selector: 'button, .card', states: ['hover'] }, 'matches more than one element'],
    [{ selector: '#missing-preview', states: ['hover'] }, 'No element in the top-level document'],
    [{ selector: 'body', states: ['hover'] }, 'not the html, head or body element'],
    [{ selector: 'a[', states: ['hover'] }, 'not valid CSS']
  ] as const) {
    const rejected = await call('browser_css_state_preview', { action: 'set', ...args })
    expect(rejected.isError, args.selector).toBe(true)
    expect(text(rejected)).toContain(message)
  }

  // The person can always end it from the address bar.
  await preview({ action: 'set', selector: '#press', states: ['active'] })
  expect(await pressBackground()).toBe(GREEN)
  const pill = appWindow.getByTestId('css-state-preview-pill')
  await expect(pill).toHaveAccessibleName('Stop forcing :active on #press')
  await expect(pill).toContainText('Forced :active')
  await pill.click()
  await expect(pill).toHaveCount(0)
  expect(await pressBackground()).toBe(WHITE)
  expect(await preview({ action: 'get' })).toMatchObject({ status: 'inactive', lastEnded: { reason: 'human-reset', clean: true } })
  expect(await evaluate(`String(window.__previewEvents)`)).toBe('0')

  await preview({ action: 'set', selector: '.card', states: ['hover'], durationMs: 1_000 })
  await expect.poll(revealColor, { timeout: 5_000 }).toBe(BLUE)
  expect(await preview({ action: 'get' })).toMatchObject({ status: 'inactive', lastEnded: { reason: 'expired' } })

  // A removed element ends the preview; a replacement with the same selector is never forced.
  await preview({ action: 'set', selector: '.card', states: ['hover'] })
  await evaluate(`(() => { const old = document.querySelector('.card'); const next = old.cloneNode(true); old.remove(); document.getElementById('preview-fixture').append(next); return true })()`)
  await expect.poll(async () => (await preview({ action: 'get' })).lastEnded?.reason, { timeout: 5_000 }).toBe('target-removed')
  expect(await revealColor()).toBe(BLUE)

  await preview({ action: 'set', selector: '.card', states: ['hover'] })
  const setPaused = (paused: boolean) => appWindow.evaluate(([id, value]) => (
    (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, value)
  ), [tabId, paused] as const)
  await setPaused(true)
  await setPaused(false)
  expect(await preview({ action: 'get' })).toMatchObject({ status: 'inactive', lastEnded: { reason: 'agent-paused' } })
  expect(await revealColor()).toBe(BLUE)

  await preview({ action: 'set', selector: '.card', states: ['hover'] })
  const navigated = await call('browser_navigate', { url: fixtureUrl })
  expect(navigated.isError, text(navigated)).not.toBe(true)
  expect(await preview({ action: 'get' })).toMatchObject({ status: 'inactive', lastEnded: { reason: 'navigation' } })
  await setUp()
  expect(await revealColor()).toBe(BLUE)
})

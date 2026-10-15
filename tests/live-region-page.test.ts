// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIVE_REGION_LIMITS, liveRegionPageScript, type LiveRegionPageAction } from '../src/shared/live-region.js'
import type { BrowserLiveRegionReport } from '../src/shared/types.js'

type PageReport = Omit<BrowserLiveRegionReport, 'tabId' | 'title' | 'url' | 'limits' | 'caveats'> & { error?: string }

const run = (action: LiveRegionPageAction, selector?: string): PageReport =>
  window.eval(liveRegionPageScript(action, selector)) as PageReport

// MutationObserver callbacks are microtasks; a macrotask boundary separates them.
const callback = () => new Promise(resolve => setTimeout(resolve, 0))

afterEach(() => {
  run('clear')
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('live region page script', () => {
  it('keeps transient updates that are gone from the final snapshot, and only from the selected region', async () => {
    document.body.innerHTML = '<div id="status" role="status" aria-live="polite"></div><p id="other">Unrelated canary</p>'
    const status = document.getElementById('status')!
    expect(run('start', '#status')).toMatchObject({ active: true, initial: { text: '', empty: true, truncated: false } })

    status.textContent = 'Loading results…'
    await callback()
    document.getElementById('other')!.textContent = 'Other region canary update'
    await callback()
    status.textContent = '12 results'
    await callback()
    status.textContent = ''
    await callback()

    const report = run('get')
    expect(report.observations.map(entry => [entry.text, entry.empty])).toEqual([
      ['Loading results…', false],
      ['12 results', false],
      ['', true]
    ])
    expect(report.observations.map(entry => entry.index)).toEqual([1, 2, 3])
    expect(report.metadata).toEqual({ role: 'status', ariaLive: 'polite' })
    expect(JSON.stringify(report)).not.toContain('canary')
  })

  it('coalesces synchronous changes into callback-time text without inventing intermediate text', async () => {
    document.body.innerHTML = '<output id="count">0 items</output>'
    const count = document.getElementById('count')!
    run('start', '#count')
    count.textContent = '1 item'
    count.textContent = '2 items'
    count.textContent = '3 items'
    await callback()
    count.textContent = '3 items'
    await callback()

    const report = run('get')
    expect(report.observations).toHaveLength(1)
    expect(report.observations[0]).toMatchObject({ text: '3 items', mutationRecords: 3 })
    expect(report).toMatchObject({ callbackCount: 2, unchangedCallbacks: 1 })
  })

  it('accepts a visually hidden region and reports authored tokens only', async () => {
    document.body.innerHTML = `<div id="sr" class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)"
      role="button status" aria-live="loud" aria-atomic="TRUE" aria-relevant="text additions bogus text" aria-busy="maybe">Saved</div>`
    const report = run('start', '#sr')
    expect(report).toMatchObject({ active: true, initial: { text: 'Saved' } })
    expect(report.metadata).toEqual({ ariaAtomic: true, ariaRelevant: ['text', 'additions'] })
  })

  it('records aria-busy on each observation as an authored token', async () => {
    document.body.innerHTML = '<section id="results" aria-busy="true"></section>'
    const results = document.getElementById('results')!
    run('start', '#results')
    results.textContent = 'Searching'
    await callback()
    results.setAttribute('aria-busy', 'false')
    results.textContent = 'Found 3'
    await callback()
    expect(run('get').observations.map(entry => entry.ariaBusy)).toEqual([true, false])
  })

  it('never reads form values, editable content, scripts, styles or frames inside the region', async () => {
    document.body.innerHTML = `<div id="region">Visible
      <input value="canary-input"><textarea>canary-textarea</textarea>
      <select><option selected>canary-option</option></select>
      <div contenteditable="true">canary-editable</div><span contenteditable="plaintext-only">canary-plain</span>
      <script>window.canary = "canary-script"</script><style>.canary-style{}</style>
      <iframe srcdoc="canary-frame"></iframe><noscript>canary-noscript</noscript><template>canary-template</template>
      <p contenteditable="false">kept</p></div>`
    const region = document.getElementById('region')!
    const initial = run('start', '#region')
    region.querySelector('input')!.value = 'canary-typed'
    region.querySelector('[contenteditable="true"]')!.textContent = 'canary-edited'
    region.append(' done')
    await callback()
    const report = run('get')
    expect(initial.initial?.text).toBe('Visible kept')
    expect(report.observations.map(entry => entry.text)).toEqual(['Visible kept done'])
    expect(JSON.stringify(report)).not.toContain('canary')
  })

  it.each([
    ['#missing', '<div></div>', 'not-found'],
    ['div', '<div></div><div></div>', 'not-unique'],
    ['body', '<div></div>', 'too-broad'],
    ['html', '<div></div>', 'too-broad'],
    ['[', '<div></div>', 'invalid-selector'],
    ['input', '<input value="canary">', 'excluded-region'],
    ['#inside', '<div contenteditable><span id="inside">canary</span></div>', 'excluded-region'],
    ['textarea', '<textarea>canary</textarea>', 'excluded-region'],
    ['#x', '<div id="x"></div>', undefined]
  ])('validates the selection %s', (selector, html, error) => {
    document.body.innerHTML = html
    const result = run('start', selector)
    if (error) expect(result).toEqual({ error })
    else expect(result).toMatchObject({ active: true })
  })

  it('rejects an empty or oversized selector', () => {
    document.body.innerHTML = '<div id="x"></div>'
    expect(run('start', '')).toEqual({ error: 'invalid-selector' })
    expect(run('start', `#x${' '.repeat(LIVE_REGION_LIMITS.maxSelectorChars)}`)).toEqual({ error: 'invalid-selector' })
  })

  it('bounds each read by characters and visited nodes before building the whole text', async () => {
    document.body.innerHTML = '<div id="long"></div><div id="wide"></div><div id="deep"></div>'
    document.getElementById('long')!.textContent = 'a'.repeat(5_000)
    const long = run('start', '#long')
    expect(long.initial).toMatchObject({ truncated: true })
    expect(long.initial!.text).toHaveLength(LIVE_REGION_LIMITS.maxObservationChars)

    const wide = document.getElementById('wide')!
    for (let index = 0; index < LIVE_REGION_LIMITS.maxNodesPerRead + 100; index += 1) wide.append(document.createElement('i'))
    wide.append(Object.assign(document.createElement('b'), { textContent: 'canary-after-budget' }))
    const wideReport = run('start', '#wide')
    expect(wideReport.initial).toEqual({ text: '', empty: true, truncated: true })

    let deep = document.getElementById('deep')!
    for (let depth = 0; depth < LIVE_REGION_LIMITS.maxNodesPerRead + 200; depth += 1) deep = deep.appendChild(document.createElement('span'))
    deep.textContent = 'canary-too-deep'
    const deepReport = run('start', '#deep')
    expect(deepReport.initial).toMatchObject({ truncated: true })
    expect(JSON.stringify([wideReport, deepReport])).not.toContain('canary')
  })

  it('compares only the bounded text, so growth beyond it reads as unchanged', async () => {
    document.body.innerHTML = '<div id="log"></div>'
    const log = document.getElementById('log')!
    run('start', '#log')
    log.textContent = 'b'.repeat(2_000)
    await callback()
    log.append('c')
    await callback()
    const report = run('get')
    expect(report.observations).toHaveLength(1)
    expect(report.observations[0]).toMatchObject({ truncated: true })
    expect(report.observations[0]!.text).toHaveLength(LIVE_REGION_LIMITS.maxObservationChars)
    expect(report).toMatchObject({ callbackCount: 2, unchangedCallbacks: 1 })
  })

  it.each([
    ['the region becomes editable', (region: HTMLElement) => region.setAttribute('contenteditable', 'true')],
    ['an ancestor becomes editable', (region: HTMLElement) => region.parentElement!.setAttribute('contenteditable', '')],
    ['the document enters design mode', () => { (document as unknown as { designMode: string }).designMode = 'on' }],
    ['the region moves into a shadow tree', (region: HTMLElement) => {
      const host = document.createElement('div')
      document.body.append(host)
      host.attachShadow({ mode: 'open' }).append(region)
    }]
  ])('stops without reading when %s after start', async (_case, change) => {
    document.body.innerHTML = '<section><div id="status">Ready</div></section>'
    const region = document.getElementById('status')!
    run('start', '#status')
    region.textContent = 'Saved'
    await callback()
    change(region)
    region.textContent = 'canary-typed-by-the-user'
    await callback()
    const report = run('get')
    expect(report).toMatchObject({ active: false, stopReason: 'excluded' })
    expect(report.observations.map(entry => entry.text)).toEqual(['Saved'])
    expect(JSON.stringify(report)).not.toContain('canary')
    ;(document as unknown as { designMode: string }).designMode = 'off'
  })

  it('does not count mutations inside skipped editable descendants', async () => {
    document.body.innerHTML = '<div id="region">Comments <div id="editor" contenteditable="true">draft</div></div>'
    const editor = document.getElementById('editor')!
    run('start', '#region')
    for (const text of ['d', 'dr', 'dra']) {
      editor.textContent = text
      await callback()
    }
    expect(run('get')).toMatchObject({ active: true, callbackCount: 0, unchangedCallbacks: 0, observations: [] })
  })

  it('stops at the observation limit', async () => {
    document.body.innerHTML = '<div id="counter"></div>'
    const counter = document.getElementById('counter')!
    run('start', '#counter')
    for (let index = 0; index < LIVE_REGION_LIMITS.maxObservations + 5; index += 1) {
      counter.textContent = String(index)
      await callback()
    }
    const report = run('get')
    expect(report).toMatchObject({ active: false, stopReason: 'observation-limit' })
    expect(report.observations).toHaveLength(LIVE_REGION_LIMITS.maxObservations)
  })

  it('stops before retaining more than the total character limit', async () => {
    document.body.innerHTML = '<div id="feed"></div>'
    const feed = document.getElementById('feed')!
    run('start', '#feed')
    for (let index = 0; index < 60; index += 1) {
      feed.textContent = `${index}`.padEnd(LIVE_REGION_LIMITS.maxObservationChars, 'x')
      await callback()
    }
    const report = run('get')
    expect(report).toMatchObject({ active: false, stopReason: 'total-char-limit' })
    expect(report.totalChars).toBeLessThanOrEqual(LIVE_REGION_LIMITS.maxTotalChars)
  })

  it('stops on request and disconnects the observer', async () => {
    document.body.innerHTML = '<div id="status">Idle</div>'
    const status = document.getElementById('status')!
    run('start', '#status')
    status.textContent = 'Saving'
    await callback()
    expect(run('stop')).toMatchObject({ active: false, stopReason: 'stopped' })
    status.textContent = 'Saved after stop'
    await callback()
    const report = run('get')
    expect(report.observations.map(entry => entry.text)).toEqual(['Saving'])
    expect(report.callbackCount).toBe(1)
  })

  it('stops when the region is removed and never rebinds to a replacement element', async () => {
    document.body.innerHTML = '<main><div id="status">Before</div></main>'
    run('start', '#status')
    document.getElementById('status')!.remove()
    const replacement = Object.assign(document.createElement('div'), { id: 'status', textContent: 'canary-replacement' })
    document.querySelector('main')!.append(replacement)
    replacement.textContent = 'canary-replacement-update'
    await callback()
    const report = run('get')
    expect(report).toMatchObject({ active: false, stopReason: 'detached', observations: [] })
    expect(JSON.stringify(report)).not.toContain('canary')
  })

  it('expires at the duration limit even when nothing reads it', () => {
    document.body.innerHTML = '<div id="status"></div>'
    const now = vi.spyOn((window as unknown as { Date: DateConstructor }).Date, 'now')
    now.mockReturnValue(1_000)
    run('start', '#status')
    now.mockReturnValue(1_000 + LIVE_REGION_LIMITS.maxDurationMs)
    expect(run('get')).toMatchObject({ active: false, stopReason: 'expired' })
  })

  it('clears retained text and replaces an earlier recording on start', async () => {
    document.body.innerHTML = '<div id="a">canary-first</div><div id="b">Second</div>'
    run('start', '#a')
    expect(run('start', '#b')).toMatchObject({ selector: '#b', initial: { text: 'Second' } })
    expect(JSON.stringify(run('get'))).not.toContain('canary')
    expect(run('clear')).toEqual({ active: false, observations: [], callbackCount: 0, unchangedCallbacks: 0, totalChars: 0 })
    expect(run('get')).toEqual({ active: false, observations: [], callbackCount: 0, unchangedCallbacks: 0, totalChars: 0 })
  })

  it('clears an earlier recording when a new selection is rejected', () => {
    document.body.innerHTML = '<div id="a">canary-first</div>'
    run('start', '#a')
    expect(run('start', '#missing')).toEqual({ error: 'not-found' })
    expect(JSON.stringify(run('get'))).not.toContain('canary')
  })

  it('reads only text through bounded DOM traversal, never markup', () => {
    const script = liveRegionPageScript('start', '#x')
    for (const unsafe of ['innerHTML', 'outerHTML', 'innerText', 'textContent', '.value', 'shadowRoot', 'contentDocument', 'ariaNotify']) {
      expect(script).not.toContain(unsafe)
    }
    expect(script).toContain('substringData')
  })
})

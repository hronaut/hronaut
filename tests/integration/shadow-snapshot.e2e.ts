import type { ElectronApplication } from '@playwright/test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

// Web components built in the page's own world: an open card with slots, a nested open component that a slot
// passes content through, private fields and an editor, a frame, a closed component and hidden content.
const COMPONENT_PAGE = `(() => {
  document.body.innerHTML = [
    '<div id="outside">OUTSIDE_TEXT <button>Outside button</button></div>',
    '<x-card id="card">',
    '<span slot="title">Slotted title SLOT_TEXT</span>',
    '<p>UNASSIGNED_TEXT</p>',
    '<b slot="pass">PASSED_TEXT</b>',
    '<div slot="editor" contenteditable="true">SLOTTED_EDITOR_SECRET</div>',
    '</x-card>',
    '<x-card id="sibling">SIBLING_TEXT</x-card>'
  ].join('');
  if (!customElements.get('x-card')) {
    customElements.define('x-card', class extends HTMLElement {});
    customElements.define('x-inner', class extends HTMLElement {});
    customElements.define('x-closed', class extends HTMLElement {});
  }
  const card = document.querySelector('#card').attachShadow({ mode: 'open' });
  card.innerHTML = [
    '<h2><slot name="title">FALLBACK_UNUSED</slot></h2>',
    '<button aria-label="Save card">S</button>',
    '<p>Shadow text SHADOW_TEXT</p>',
    '<x-inner><slot name="pass"></slot></x-inner>',
    '<slot name="missing">USED_FALLBACK</slot>',
    '<label id="name-label">Full name</label><input aria-labelledby="name-label" value="SECRET_VALUE">',
    '<textarea aria-label="Notes">SECRET_TEXTAREA</textarea>',
    '<slot name="editor"></slot>',
    '<iframe srcdoc="<p>FRAME_TEXT</p>"></iframe>',
    '<x-closed>CLOSED_LIGHT_TEXT</x-closed>',
    '<div hidden>HIDDEN_TEXT</div>',
    '<div style="visibility:hidden">INVISIBLE_TEXT <span style="visibility:visible">VISIBLE_AGAIN</span></div>'
  ].join('');
  const inner = card.querySelector('x-inner').attachShadow({ mode: 'open' });
  inner.innerHTML = '<a href="https://example.test/docs?token=abc#frag">Docs link</a> <slot>INNER_FALLBACK</slot>';
  card.querySelector('x-closed').attachShadow({ mode: 'closed' }).innerHTML = '<p>CLOSED_TEXT</p>';
  document.querySelector('#sibling').attachShadow({ mode: 'open' }).innerHTML = '<p>SIBLING_SHADOW_TEXT</p><slot></slot>';
  return true;
})()`

async function onPage<T>(app: ElectronApplication, url: string, script: string): Promise<T> {
  return app.evaluate(async ({ webContents }, { url, script }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
    if (!page) throw new Error('Missing shadow fixture page')
    return page.executeJavaScript(script) as Promise<T>
  }, { url, script })
}

test('reads one component\'s open shadow content, slots and nested roots once, without private values, frames, closed roots or page changes', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const snapshot = (args: Record<string, unknown>) => client.callTool({ name: 'browser_snapshot', arguments: { tabId, ...args } }) as Promise<CallToolResult>
  await onPage(electronApp, fixtureUrl, COMPONENT_PAGE)

  // A whole-page snapshot first: its refs must survive the shadow capture.
  const page = await snapshot({})
  expect(page.isError, text(page)).not.toBe(true)
  const pageRef = /\[(e\d+)\] button "Outside button"/.exec(text(page))?.[1]
  expect(pageRef, text(page)).toBeTruthy()
  // The gap this capture fills: a page snapshot sees none of the shadow content.
  expect(text(page)).not.toMatch(/Save card|SHADOW_TEXT|Docs link/)
  // Watch the page from its own world for any change the capture might make.
  await onPage(electronApp, fixtureUrl, `(() => {
    window.shadowChanges = 0;
    const observer = new MutationObserver((records) => { window.shadowChanges += records.length; });
    const options = { subtree: true, childList: true, attributes: true, characterData: true };
    observer.observe(document, options);
    const card = document.querySelector('#card').shadowRoot;
    observer.observe(card, options);
    observer.observe(card.querySelector('x-inner').shadowRoot, options);
    window.shadowFocus = document.activeElement;
    window.shadowScroll = [scrollX, scrollY];
    return true;
  })()`)

  const capture = await snapshot({ shadowHostSelector: '#card' })
  expect(capture.isError, text(capture)).not.toBe(true)
  const body = text(capture)
  expect(body.split('\n')[0]).toBe('SCOPE: open shadow root of <x-card>; read-only, no refs; content outside it, closed shadow roots and frames are not included')
  expect(body).toContain('NOT READ: frames, editor content')
  expect(body).toContain('h2: Slotted title SLOT_TEXT')
  expect(body).toContain('button "Save card"')
  expect(body).toContain('input "Full name"')
  expect(body).toContain('textarea "Notes"')
  expect(body).toContain('div ""')
  expect(body).toMatch(/a "Docs link" href="https:\/\/example\.test\/docs\?token=%5BREDACTED%5D"/)
  for (const shown of ['SHADOW_TEXT', 'PASSED_TEXT', 'USED_FALLBACK', 'VISIBLE_AGAIN']) expect(body).toContain(shown)
  expect(body.match(/PASSED_TEXT/g)).toHaveLength(1)
  expect(body).toContain('Docs link PASSED_TEXT')
  expect(body.match(/SLOT_TEXT/g)).toHaveLength(2) // once as the heading, once in the text
  for (const omitted of [
    'OUTSIDE_TEXT', 'Outside button', 'SIBLING', 'UNASSIGNED_TEXT', 'FALLBACK_UNUSED', 'INNER_FALLBACK',
    'SECRET', 'FRAME_TEXT', 'CLOSED_TEXT', 'CLOSED_LIGHT_TEXT', 'HIDDEN_TEXT', 'INVISIBLE_TEXT', 'abc', 'frag', '[e'
  ]) expect(body, omitted).not.toContain(omitted)
  expect(capture.structuredContent).toMatchObject({
    kind: 'shadow-observation',
    formatVersion: 1,
    scope: { kind: 'open-shadow-root', hostTag: 'x-card', refs: false, outsideScopeOmitted: true },
    untrusted: true,
    completeness: { complete: true, omissions: ['frames', 'private-editors'], absenceNotEstablished: false },
    coverage: { shadowRoots: 2, assignedSlots: 4 }
  })
  expect((capture.structuredContent as { captureId: string }).captureId).toMatch(/^[0-9a-f-]{36}$/)
  const again = await snapshot({ shadowHostSelector: '#card' })
  expect((again.structuredContent as { captureId: string }).captureId).not.toBe((capture.structuredContent as { captureId: string }).captureId)

  expect(await onPage(electronApp, fixtureUrl, `(() => ({
    changes: window.shadowChanges,
    focus: document.activeElement === window.shadowFocus,
    scroll: scrollX === window.shadowScroll[0] && scrollY === window.shadowScroll[1],
    ref: document.querySelector('#outside button').getAttribute('data-hronaut-ref')
  }))()`)).toEqual({ changes: 0, focus: true, scroll: true, ref: pageRef })
})

test('refuses hosts it cannot read without falling back to the page', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const snapshot = (args: Record<string, unknown>) => client.callTool({ name: 'browser_snapshot', arguments: { tabId, ...args } }) as Promise<CallToolResult>
  await onPage(electronApp, fixtureUrl, COMPONENT_PAGE)
  await onPage(electronApp, fixtureUrl, `(() => {
    document.body.insertAdjacentHTML('beforeend', '<x-closed id="closed"></x-closed><input id="field"><div id="gone" style="display:none"></div><div contenteditable="true"><span id="editable"></span></div>');
    document.querySelector('#closed').attachShadow({ mode: 'closed' }).innerHTML = '<p>CLOSED_TEXT</p>';
    document.querySelector('#gone').attachShadow({ mode: 'open' }).innerHTML = '<p>GONE_TEXT</p>';
    document.querySelector('#editable').attachShadow({ mode: 'open' }).innerHTML = '<p>EDITABLE_TEXT</p>';
    return true;
  })()`)
  const refusals: Array<[Record<string, unknown>, RegExp]> = [
    [{ shadowHostSelector: '#nope' }, /Shadow host was not found in the top-level page; selectors do not reach into shadow roots/],
    [{ shadowHostSelector: '#card button' }, /Shadow host was not found/],
    [{ shadowHostSelector: 'div[' }, /not valid CSS/],
    [{ shadowHostSelector: 'x-card' }, /exactly one element/],
    [{ shadowHostSelector: '#closed' }, /no open shadow root; closed shadow roots/],
    [{ shadowHostSelector: '#field' }, /no open shadow root/],
    [{ shadowHostSelector: '#gone' }, /not rendered or not visible/],
    [{ shadowHostSelector: '#editable' }, /inside editable content/],
    [{ shadowHostSelector: '#card', action: 'set-baseline' }, /only for capture, without rootSelector or frameSelector/],
    [{ shadowHostSelector: '#card', rootSelector: '#card' }, /only for capture, without rootSelector or frameSelector/]
  ]
  for (const [args, message] of refusals) {
    const result = await snapshot(args)
    expect(result.isError, JSON.stringify(args)).toBe(true)
    expect(text(result), JSON.stringify(args)).toMatch(message)
    expect(text(result)).not.toMatch(/OUTSIDE_TEXT|CLOSED_TEXT|GONE_TEXT|EDITABLE_TEXT/)
  }
})

test('stops deep, wide and long components at their limits and says the capture is incomplete', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const snapshot = (args: Record<string, unknown>) => client.callTool({ name: 'browser_snapshot', arguments: { tabId, ...args } }) as Promise<CallToolResult>
  await onPage(electronApp, fixtureUrl, `(() => {
    document.body.innerHTML = '<div id="deep"></div><div id="wide"></div><div id="long"></div>';
    let level = document.querySelector('#deep').attachShadow({ mode: 'open' });
    for (let depth = 0; depth < 150; depth += 1) { const next = document.createElement('div'); level.append(next); level = next; }
    level.append('DEEP_END');
    document.querySelector('#wide').attachShadow({ mode: 'open' }).innerHTML = '<span>w</span>'.repeat(12000) + '<button>WIDE_END</button>';
    document.querySelector('#long').attachShadow({ mode: 'open' }).innerHTML = '<p>' + 'long text '.repeat(400) + 'LONG_END</p>';
    return true;
  })()`)
  const cases: Array<[string, Record<string, unknown>, string, string]> = [
    ['#deep', {}, 'depth-limit', 'DEEP_END'],
    ['#wide', {}, 'node-limit', 'WIDE_END'],
    ['#long', { maxChars: 1_000 }, 'text-limit', 'LONG_END']
  ]
  for (const [host, extra, omission, end] of cases) {
    const result = await snapshot({ shadowHostSelector: host, ...extra })
    expect(result.isError, text(result)).not.toBe(true)
    expect(result.structuredContent, host).toMatchObject({ completeness: { complete: false, absenceNotEstablished: true } })
    expect((result.structuredContent as { completeness: { omissions: string[] } }).completeness.omissions, host).toContain(omission)
    expect(text(result), host).not.toContain(end)
    if (omission !== 'text-limit') expect(text(result), host).toContain(`INCOMPLETE: stopped at ${omission}; a heading, control or text missing here may still exist`)
    else expect(text(result).length).toBeLessThanOrEqual(1_000)
  }
})

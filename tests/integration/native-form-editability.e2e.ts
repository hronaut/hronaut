import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

interface Witness {
  controls: Array<{ id: string; value: string; checked: boolean | null }>
  events: Array<{ id: string; kind: string }>
  submits: number
}

interface FormCase {
  name: string
  html: string
  value: string
  reason?: 'disabled' | 'readonly'
  focusMutation?: boolean
  precedingMutation?: boolean
  checked?: boolean
}

const inputValues: Record<string, [string, string]> = {
  text: ['original-canary', 'replacement-canary'], search: ['old', 'new'], tel: ['123', '456'],
  url: ['https://old.invalid', 'https://new.invalid'], email: ['old@example.invalid', 'new@example.invalid'],
  password: ['old-secret-canary', 'new-secret-canary'], date: ['2026-01-01', '2026-02-02'],
  month: ['2026-01', '2026-02'], week: ['2026-W01', '2026-W02'], time: ['01:00', '02:00'],
  'datetime-local': ['2026-01-01T01:00', '2026-02-02T02:00'], number: ['11', '22']
}

function cases(batch: boolean): FormCase[] {
  const result: FormCase[] = []
  const controls = {
    input: '<input id="target" value="original-canary" ATTR>',
    textarea: '<textarea id="target" ATTR>original-canary</textarea>',
    select: '<select id="target" ATTR><option value="original-canary">Original</option><option value="replacement-canary">Replacement</option></select>',
    checkbox: '<input id="target" type="checkbox" value="original-canary" ATTR>',
    radio: '<input id="target" type="radio" value="original-canary" ATTR>'
  }
  for (const [kind, template] of Object.entries(controls)) {
    const checked = batch && ['checkbox', 'radio'].includes(kind)
    const add = (name: string, html: string, reason?: FormCase['reason'], focusMutation = false) =>
      result.push({ name: `${kind}-${name}`, html, value: 'replacement-canary', reason, focusMutation, checked })
    add('disabled', template.replace('ATTR', 'disabled'), 'disabled')
    add('fieldset', `<fieldset disabled>${template.replace('ATTR', '')}</fieldset>`, 'disabled')
    add('first-legend', `<fieldset disabled><legend>${template.replace('ATTR', '')}</legend></fieldset>`)
    add('second-legend', `<fieldset disabled><legend>First</legend><legend>${template.replace('ATTR', '')}</legend></fieldset>`, 'disabled')
    add('focus-disabled', template.replace('ATTR', 'onfocus="this.disabled=true"'), 'disabled', true)
    add('aria-only', template.replace('ATTR', 'aria-disabled="true" aria-readonly="true"'))
    if (['checkbox', 'radio', 'select'].includes(kind)) add('readonly-inapplicable', template.replace('ATTR', 'readonly'))
  }
  for (const [type, [oldValue, value]] of Object.entries(inputValues)) {
    for (const live of [false, true]) result.push({
      name: `${type}-${live ? 'focus-' : ''}readonly`, value, reason: 'readonly', focusMutation: live,
      html: `<input id="target" type="${type}" value="${oldValue}" ${live ? 'onfocus="this.readOnly=true"' : 'readonly'}>`
    })
  }
  for (const live of [false, true]) result.push({
    name: `textarea-${live ? 'focus-' : ''}readonly`, value: 'replacement-canary', reason: 'readonly', focusMutation: live,
    html: `<textarea id="target" ${live ? 'onfocus="this.readOnly=true"' : 'readonly'}>original-canary</textarea>`
  })
  for (const [type, oldValue, value] of [['range', '11', '22'], ['color', '#112233', '#445566'], ['hidden', 'old', 'new']] as const) {
    // Hidden controls have no snapshot ref; exercise them through selectors below.
    result.push({ name: `${type}-readonly-inapplicable`, value, html: `<input id="target" type="${type}" readonly value="${oldValue}">` })
  }
  result.push({ name: 'contenteditable', value: 'replacement-canary', html: '<div id="target" contenteditable="true">original-canary</div>' })
  if (batch) for (const reason of ['disabled', 'readonly'] as const) result.push({
    name: `preceding-focus-${reason}`, value: 'replacement-canary', reason, precedingMutation: true,
    html: '<input id="target" value="original-canary">'
  })
  return result
}

for (const batch of [false, true]) for (const targetKind of ['selector', 'ref'] as const) {
  test(`form writes respect live native editability: ${batch ? 'batch' : 'individual'} ${targetKind}`, async ({ capabilities, electronApp }) => {
    test.setTimeout(180_000)
    const samples = cases(batch).filter(item => targetKind !== 'ref' || !item.name.startsWith('hidden-'))
    const server = createServer((request, response) => {
      const item = samples[Number(new URL(request.url!, 'http://localhost').searchParams.get('case'))]
      if (!item) { response.writeHead(404).end(); return }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><title>Native form fixture</title>
        <form><input id="prefix" value="prefix-original" ${item.precedingMutation ? `onfocus="target.${item.reason === 'disabled' ? 'disabled' : 'readOnly'}=true"` : ''}>
        ${item.html}<input id="suffix" value="suffix-original"></form><script>
        window.events=[]; window.submits=0;
        for(const kind of ['focus','input','change'])document.addEventListener(kind,e=>events.push({id:e.target.id,kind}),true);
        document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();submits++});
        window.witness=()=>({controls:['prefix','target','suffix'].map(id=>{const e=document.getElementById(id);return {id,value:e.value??e.textContent,checked:e.checked??null}}),events,submits});
        </script>`)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('Missing fixture port')
    const call = async (name: string, args: Record<string, unknown>) => capabilities.client.callTool({ name, arguments: { tabId: capabilities.tabId, ...args } }) as Promise<CallToolResult>
    try {
      for (const [index, item] of samples.entries()) {
        const url = `http://127.0.0.1:${address.port}/?case=${index}`
        expect((await call('browser_navigate', { url })).isError).not.toBe(true)
        await call('browser_wait', { selector: '#target' })
        const page = electronApp.context().pages().find(page => page.url() === url)!
        if (targetKind === 'ref') expect((await call('browser_snapshot', {})).isError).not.toBe(true)
        const targets = await page.evaluate(kind => Object.fromEntries(['prefix', 'target', 'suffix'].map(id => {
          const e = document.getElementById(id)!
          return [id, kind === 'ref' ? { ref: e.getAttribute('data-hronaut-ref')! } : { selector: '#' + id }]
        })), targetKind)
        if (targetKind === 'ref') for (const target of Object.values(targets)) expect(target.ref, item.name).toMatch(/^e\d+$/)
        const before = await page.evaluate<Witness>('witness()')
        const selecting = item.html.includes('<select')
        const response = await call(batch ? 'browser_fill_form' : selecting ? 'browser_select' : 'browser_type', batch
          ? { fields: [{ ...targets.prefix, value: 'prefix-new' }, { ...targets.target, value: item.checked ? true : item.value }, { ...targets.suffix, value: 'suffix-new' }] }
          : { ...targets.target, ...(selecting ? { value: item.value } : { text: item.value, submit: Boolean(item.reason) }) })
        const after = await page.evaluate<Witness>('witness()')
        const targetEvents = after.events.filter((event: { id: string }) => event.id === 'target')
        expect(response.isError === true, `${item.name}: ${text(response)}`).toBe(Boolean(item.reason))
        if (item.reason) {
          expect(text(response), item.name).toContain(`${batch ? 'Form field 2' : 'Target'} is natively ${item.reason}; form write rejected`)
          expect(text(response)).not.toContain('canary')
          expect(after.controls[1], item.name).toEqual(before.controls[1])
          expect(targetEvents.filter((event: { kind: string }) => event.kind !== 'focus'), item.name).toEqual([])
          if (!item.focusMutation) expect(targetEvents, item.name).toEqual([])
          expect(after.submits, item.name).toBe(0)
          expect(after.controls[2], item.name).toEqual(before.controls[2])
          if (batch) {
            expect(after.controls[0]!.value, item.name).toBe('prefix-new')
            expect(after.events.filter((event: { id: string }) => event.id === 'prefix').map((event: { kind: string }) => event.kind)).toEqual(['focus', 'input', 'change'])
            expect(after.events.filter((event: { id: string }) => event.id === 'suffix')).toEqual([])
          }
        } else {
          expect(item.checked ? after.controls[1]!.checked : after.controls[1]!.value, item.name).toBe(item.checked ? true : item.value)
          expect(targetEvents.map((event: { kind: string }) => event.kind), item.name).toEqual(expect.arrayContaining(['input', 'change']))
          if (batch) expect(after.controls[2]!.value, item.name).toBe('suffix-new')
        }
      }
    } finally { await closeFixtureServer(server) }
  })
}

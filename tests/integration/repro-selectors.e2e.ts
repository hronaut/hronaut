import { formatReproAsPlaywright } from '../../src/shared/repro-export.js'
import type { BrowserReproRecording } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'
import type { Page } from '@playwright/test'

test('replays a recorded light-DOM click without matching buttons inside shadow roots', async ({ appWindow, electronApp }) => {
  const html = `<!doctype html><title>Recorder shadow scope</title><button id="light">Light button</button><custom-widget></custom-widget>
    <script>
      window.clicks = { light: 0, shadow: 0 };
      document.querySelector('#light').onclick = () => window.clicks.light++;
      const root = document.querySelector('custom-widget').attachShadow({ mode: 'open' });
      root.innerHTML = '<button>Shadow button</button>';
      root.querySelector('button').onclick = () => window.clicks.shadow++;
    </script>`
  const url = `data:text/html,${encodeURIComponent(html)}`
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
  await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
  const page = electronApp.context().pages().find(page => page.url() === url)!
  await expect(page.locator('#light')).toBeVisible()
  await appWindow.evaluate("window.hronaut.manageRepro('start')")
  await electronApp.evaluate(async ({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
    const point = await page.executeJavaScript(`(() => {
      const bounds = document.querySelector('#light').getBoundingClientRect();
      return { x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + bounds.height / 2) };
    })()`)
    page.focus()
    page.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
    page.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
  }, url)
  await expect.poll(() => appWindow.evaluate("window.hronaut.manageRepro('get').then(report => report.steps.some(step => step.kind === 'click'))")).toBe(true)
  const recording = await appWindow.evaluate("window.hronaut.manageRepro('stop')") as BrowserReproRecording
  const click = recording.steps.find(step => step.kind === 'click')!
  expect(click.target?.selector).toBe('button')
  expect(await page.locator('button').count()).toBe(2)
  // Replay the actual exported click on the existing fixture. Omit the recorded
  // navigation because data URLs are intentionally redacted in reproduction logs.
  const exported = formatReproAsPlaywright({ ...recording, steps: [click], stepCount: 1 })
  let replay: Promise<void> | undefined
  new Function('test', exported.replace(/^import[^\n]*\n/u, ''))((_name: string, body: (context: { page: Page }) => Promise<void>) => {
    replay = body({ page })
  })
  // Action-only exports must still reach their deliberate missing-assertion error.
  await expect(replay).rejects.toThrow('TODO: replace this line with an assertion')
  expect(await page.evaluate('window.clicks')).toEqual({ light: 2, shadow: 0 })
})

for (const unresolved of [false, true]) {
  test(`records ${unresolved ? 'an explicit manual target beyond the selector bound' : 'a unique target in repeated deep layouts'}`, async ({ appWindow, electronApp }) => {
    const wrapper = unresolved ? `custom-${'a'.repeat(510)}` : 'div'
    const nested = `<${wrapper}>`.repeat(9) + '<button>Continue</button>' + `</${wrapper}>`.repeat(9)
    const html = `<!doctype html><title>Recorder selectors</title><section>${nested}</section><section>${nested}</section>`
    const url = `data:text/html,${encodeURIComponent(html)}`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.title)')).toBe('Recorder selectors')
    await appWindow.evaluate("window.hronaut.manageRepro('start')")
    await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getTitle() === 'Recorder selectors')!
      const point = await page.executeJavaScript(`(() => {
        const button = document.querySelectorAll('button')[1];
        button.scrollIntoView();
        const bounds = button.getBoundingClientRect();
        return { x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + bounds.height / 2) };
      })()`)
      page.focus()
      page.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
      page.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
    })
    await expect.poll(() => appWindow.evaluate("window.hronaut.manageRepro('get').then(report => report.steps.some(step => step.kind === 'click'))")).toBe(true)
    const recording = await appWindow.evaluate("window.hronaut.manageRepro('stop')") as BrowserReproRecording
    const click = recording.steps.find(step => step.kind === 'click')!
    if (unresolved) {
      expect(click.target).toMatchObject({ selector: '', tag: 'button' })
      expect(formatReproAsPlaywright(recording)).toContain(`// TODO: Recreate step ${click.index}: click`)
    } else {
      expect(await electronApp.evaluate(async ({ webContents }, selector) => {
        const page = webContents.getAllWebContents().find(contents => contents.getTitle() === 'Recorder selectors')!
        return page.executeJavaScript(`(() => { const matches = document.querySelectorAll(${JSON.stringify(selector)}); return matches.length === 1 && matches[0] === document.querySelectorAll('button')[1]; })()`)
      }, click.target!.selector)).toBe(true)
    }
  })
}

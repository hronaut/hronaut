import type { BrowserReproRecording } from '../../src/shared/types.js'
import { formatReproAsPlaywright } from '../../src/shared/repro-export.js'
import { expect, test } from './fixtures.js'

for (const scope of ['frame', 'shadow'] as const) {
  test(`retains a native click inside a ${scope} as a manual reproduction target`, async ({ appWindow, electronApp }) => {
    const button = '<button style="width:160px;height:60px" onclick="parent.nativeClicks++">Continue</button>'
    const html = scope === 'frame'
      ? `<iframe srcdoc="${button.replaceAll('"', '&quot;')}"></iframe><script>window.nativeClicks=0</script>`
      : `<custom-widget></custom-widget><script>window.nativeClicks=0;document.querySelector('custom-widget').attachShadow({mode:'open'}).innerHTML=${JSON.stringify(button)}</script>`
    const url = `data:text/html,${encodeURIComponent(html)}`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.loading)')).toBe(false)
    await appWindow.evaluate("window.hronaut.manageRepro('start')")
    await electronApp.evaluate(async ({ webContents }, { url, scope }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      const point = await page.executeJavaScript(`(() => {
        const frame = document.querySelector('iframe');
        const root = ${JSON.stringify(scope)} === 'frame' ? frame.contentDocument : document.querySelector('custom-widget').shadowRoot;
        const bounds = root.querySelector('button').getBoundingClientRect();
        const offset = frame?.getBoundingClientRect() ?? { left: 0, top: 0 };
        return { x: Math.round(offset.left + bounds.left + bounds.width / 2), y: Math.round(offset.top + bounds.top + bounds.height / 2) };
      })()`)
      page.focus()
      page.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
      page.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
    }, { url, scope })
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      return page.executeJavaScript('window.nativeClicks')
    }, url)).toBe(1)
    await expect.poll(() => appWindow.evaluate("window.hronaut.manageRepro('get').then(report => report.steps.some(step => step.kind === 'click'))")).toBe(true)
    const recording = await appWindow.evaluate("window.hronaut.manageRepro('stop')") as BrowserReproRecording
    const click = recording.steps.find(step => step.kind === 'click')!
    expect(click.target?.selector).toBe('')
    const exported = formatReproAsPlaywright({ ...recording, steps: [click], stepCount: 1 })
    expect(exported).toContain(`TODO: Recreate step ${click.index}: click`)
    expect(exported).not.toContain('.click()')
  })
}

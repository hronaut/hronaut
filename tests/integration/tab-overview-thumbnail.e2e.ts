import type { Page } from '@playwright/test'
import type { BrowserState, BrowserTabOverviewPreview } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'
import { openTabsView } from './home-tabs-view.js'

const cornerPage = `<!doctype html><title>Sharp overview</title><style>
html,body{margin:0;background:#182238;color:white;font:32px system-ui}main{padding:120px}h1{font-size:64px}
i{position:fixed;width:100px;height:100px}.tl{left:0;top:0;background:#ed2639}.tr{right:0;top:0;background:#26d65b}.bl{left:0;bottom:0;background:#2663ed}.br{right:0;bottom:0;background:#edc926}
</style><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i><main><h1>Readable overview</h1><p>Capture the full viewport with enough pixels for this larger card.</p></main>`

async function openPage(page: Page, html = cornerPage): Promise<{ id: string; url: string }> {
  const url = `data:text/html,${encodeURIComponent(html)}`
  const id = await page.evaluate<string>(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true }).then(state => state.activeTabId)`)
  await expect.poll(() => page.evaluate<boolean | undefined>(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(id)})?.loading)`)).toBe(false)
  await expect.poll(() => preview(page, id).then(value => Boolean(value))).toBe(true)
  return { id, url }
}

async function preview(page: Page, id: string): Promise<BrowserTabOverviewPreview | undefined> {
  const home = page.context().pages().find(candidate => candidate.url().startsWith('hronaut://home'))
  if (!home) return undefined
  return home.evaluate(id => (window as unknown as { hronautHome: { getTabPreviews(ids: string[]): Promise<BrowserTabOverviewPreview[]> } }).hronautHome
    .getTabPreviews([id]).then(items => items[0]), id)
}

function expectBounded(image: BrowserTabOverviewPreview, maxWidth: number, maxHeight: number): void {
  expect(image.width).toBeLessThanOrEqual(maxWidth)
  expect(image.height).toBeLessThanOrEqual(maxHeight)
  expect(Buffer.from(image.dataUrl.split(',')[1]!, 'base64').byteLength).toBeLessThanOrEqual(256 * 1024)
}

test('pictures a website tab sharply at its card size in the Tabs view, with every corner', async ({ appWindow, electronApp }, testInfo) => {
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1900, 1100))
  const target = await openPage(appWindow)
  const state = await appWindow.evaluate<BrowserState>('window.hronaut.getState()')
  expect(state.tabs.some(tab => tab.url.startsWith('hronaut://home'))).toBe(true)
  expect(state.tabs.filter(tab => !tab.url.startsWith('hronaut://home'))).toHaveLength(1)
  const captured = (await preview(appWindow, target.id))!
  expectBounded(captured, 480, 300)
  const { home, results } = await openTabsView(appWindow, electronApp)
  const image = results.locator('.tab-card-preview > img')
  await expect(image).toHaveJSProperty('naturalWidth', captured.width)
  const displayed = (await results.locator('.tab-card-preview').boundingBox())!
  const pixelRatio = await home.evaluate(() => devicePixelRatio)
  expect(captured.width, 'The picture has a pixel for every pixel the card shows').toBeGreaterThanOrEqual(Math.floor(displayed.width * pixelRatio))
  const colors = await appWindow.evaluate(async (dataUrl) => {
    const image = new Image()
    image.src = dataUrl
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    return [[10, 10], [canvas.width - 11, 10], [10, canvas.height - 11], [canvas.width - 11, canvas.height - 11]]
      .map(([x, y]) => [...context.getImageData(x!, y!, 1, 1).data].slice(0, 3))
  }, captured.dataUrl)
  for (const [index, expected] of [[237, 38, 57], [38, 214, 91], [38, 99, 237], [237, 201, 38]].entries()) {
    for (let channel = 0; channel < 3; channel += 1) expect(Math.abs(colors[index]![channel]! - expected[channel]!)).toBeLessThan(20)
  }
  await home.screenshot({ path: testInfo.outputPath('single-thumbnail-sharp.png') })
})

test('keeps every tab picture within the resource budget, a noisy page included', async ({ appWindow, electronApp }, testInfo) => {
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1920, 1305))
  const first = await openPage(appWindow)
  const html = `<!doctype html><title>High entropy overview</title><style>html,body{margin:0;overflow:hidden}canvas{display:block;image-rendering:pixelated}</style><canvas></canvas><script>
    const canvas=document.querySelector('canvas');canvas.width=Math.ceil(innerWidth/2);canvas.height=Math.ceil(innerHeight/2);canvas.style.width=(canvas.width*2)+'px';canvas.style.height=(canvas.height*2)+'px';
    const context=canvas.getContext('2d');const image=context.createImageData(canvas.width,canvas.height);let seed=123456789;
    for(let i=0;i<image.data.length;i+=4){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const value=(seed&1)*255;image.data[i]=value;image.data[i+1]=value;image.data[i+2]=value;image.data[i+3]=255}context.putImageData(image,0,0);
  </script>`
  const noisy = await openPage(appWindow, html)
  for (const id of [first.id, noisy.id]) expectBounded((await preview(appWindow, id))!, 480, 300)
  const { home, results } = await openTabsView(appWindow, electronApp)
  await expect(results.locator('.tab-card-preview > img')).toHaveCount(2)
  await home.screenshot({ path: testInfo.outputPath('thumbnails-noise.png') })
})

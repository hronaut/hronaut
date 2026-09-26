import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('listener startup preserves the initialized Home document and setup draft', async ({ profileDirectory, mcpPort }) => {
  const hook = join(profileDirectory, 'hold-mcp-startup.cjs')
  await writeFile(hook, `
    const { Server } = require('node:http');
    const original = Server.prototype.listen;
    Server.prototype.listen = function (...args) {
      const port = typeof args[0] === 'object' ? args[0].port : args[0];
      if (Number(port) !== Number(process.env.HRONAUT_MCP_PORT)) return original.apply(this, args);
      Server.prototype.listen = original;
      globalThis.__completeMcpStartup = () => { delete globalThis.__completeMcpStartup; original.apply(this, args); };
      return this;
    };
  `)
  const { app } = await launchHronaut(profileDirectory, mcpPort, 1, [], ['--require', hook])
  const home = (source: string) => app.evaluate(async ({ webContents }, script) => {
    const contents = webContents.getAllWebContents().find(item => item.getURL().startsWith('hronaut://home'))
    return contents?.executeJavaScript(script)
  }, source)
  try {
    await expect.poll(() => home('Boolean(document.querySelector("#server-state .dot.starting"))')).toBe(true)
    await home(`
      document.querySelector('[data-home-view="connect"]').click();
      const search = document.getElementById('agent-search');
      search.focus(); search.value = 'codex'; search.dispatchEvent(new Event('input'));
      window.__startupDocument = 'before-ready';
    `)
    await app.evaluate(() => {
      const finish = (globalThis as typeof globalThis & { __completeMcpStartup?: () => void }).__completeMcpStartup
      if (!finish) throw new Error('MCP listener did not reach the controlled startup boundary')
      finish()
    })
    await expect.poll(() => home('Boolean(document.querySelector("#server-state .dot.ready"))')).toBe(true)
    expect(await home(`({ document: window.__startupDocument, draft: document.getElementById('agent-search').value,
      focused: document.activeElement.id, view: document.documentElement.dataset.homeSelectedView })`)).toEqual({
      document: 'before-ready', draft: 'codex', focused: 'agent-search', view: 'connect'
    })
  } finally { await closeHronaut(app) }
})

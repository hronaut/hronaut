import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Page } from '@playwright/test'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

const exec = promisify(execFile)

// Hronaut had no secure DNS setting: Chromium looked up every address in its own Automatic mode. As in Chrome's Use
// secure DNS, a chosen provider now looks up every address, from startup on, and turning the setting off stops that.
// The provider here is a DNS over HTTPS server that answers 127.0.0.1 for names under .test, which plain DNS cannot
// look up, so a page under .test opens only when the provider looked it up. The app trusts its certificate through
// Chromium's --ignore-certificate-errors, as no partition exists before startup to trust it in.

/** The name asked in a DNS message, its type, and an answer of 127.0.0.1 for an A question under .test. */
function dnsAnswer(query: Buffer): { name: string; type: number; answer: Buffer } {
  const labels: string[] = []
  let offset = 12
  while (query[offset] !== 0) {
    labels.push(query.subarray(offset + 1, offset + 1 + query[offset]!).toString('latin1'))
    offset += query[offset]! + 1
  }
  const name = labels.join('.').toLowerCase()
  const type = query.readUInt16BE(offset + 1)
  const found = type === 1 && name.endsWith('.test')
  const header = Buffer.alloc(12)
  query.copy(header, 0, 0, 2)
  header.writeUInt16BE(0x8180, 2)
  header.writeUInt16BE(1, 4)
  header.writeUInt16BE(found ? 1 : 0, 6)
  const record = found ? Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 127, 0, 0, 1]) : Buffer.alloc(0)
  return { name, type, answer: Buffer.concat([header, query.subarray(12, offset + 5), record]) }
}

async function openAddress(window: Page, url: string): Promise<void> {
  await window.evaluate('window.hronaut.newTab({ active: true })')
  const address = window.getByRole('combobox', { name: 'Address', exact: true })
  await address.fill(url)
  await address.press('Enter')
}

test('looks up addresses through the chosen secure DNS provider from startup, and stops when it is turned off', async ({ profileDirectory, mcpPort }) => {
  const certificates = await mkdtemp(join(tmpdir(), 'hronaut-secure-dns-'))
  const asked: string[] = []
  const website = createHttpServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>Found ${(request.headers.host ?? '').split(':')[0]}</title><main>Found</main>`)
  })
  let provider: ReturnType<typeof createHttpsServer> | undefined
  let instance: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    await exec('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
      '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', join(certificates, 'key.pem'), '-out', join(certificates, 'cert.pem')
    ])
    provider = createHttpsServer({
      key: await readFile(join(certificates, 'key.pem')),
      cert: await readFile(join(certificates, 'cert.pem'))
    }, (request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const query = request.method === 'GET'
          ? Buffer.from(new URL(request.url ?? '/', 'https://127.0.0.1').searchParams.get('dns') ?? '', 'base64url')
          : Buffer.concat(chunks)
        const { name, type, answer } = dnsAnswer(query)
        if (type === 1) asked.push(name)
        response.writeHead(200, { 'content-type': 'application/dns-message' })
        response.end(answer)
      })
    })
    await new Promise<void>((resolve) => provider!.listen(0, '127.0.0.1', resolve))
    await new Promise<void>((resolve) => website.listen(0, '127.0.0.1', resolve))
    const template = `https://127.0.0.1:${(provider.address() as { port: number }).port}/dns-query`
    const page = (name: string) => `http://${name}:${(website.address() as { port: number }).port}/`
    const settingsPath = join(profileDirectory, 'settings.json')
    const saved = async () => {
      const { secureDnsMode, secureDnsTemplate } = JSON.parse(await readFile(settingsPath, 'utf8'))
      return { secureDnsMode, secureDnsTemplate }
    }
    await writeFile(settingsPath, `${JSON.stringify({
      theme: 'system', interfaceScale: 1, tabPosition: 'top', mcpToolSet: 'complete', mcpAuthentication: false,
      secureDnsMode: 'secure', secureDnsTemplate: template
    }, null, 2)}\n`, 'utf8')
    const launch = () => launchHronaut(profileDirectory, mcpPort, 1, [], ['--ignore-certificate-errors'])

    instance = await launch()
    let window = instance.window
    await openAddress(window, page('saved.hronaut.test'))
    await expect(window.getByRole('tab', { name: /Found saved\.hronaut\.test/ })).toBeVisible()
    expect(asked).toContain('saved.hronaut.test')

    await window.getByRole('button', { name: 'Settings' }).click()
    await window.getByRole('button', { name: /Workspaces & data/ }).click()
    const secureDns = window.getByRole('tabpanel', { name: 'Settings' }).getByRole('region', { name: 'Secure DNS' })
    const use = secureDns.getByRole('checkbox', { name: /Use secure DNS/ })
    const choice = secureDns.getByRole('combobox', { name: /Provider/ })
    const field = secureDns.getByLabel('Provider address')
    await expect(use).toBeChecked()
    await expect(choice).toHaveValue('custom')
    await expect(field).toHaveValue(template)

    // Off, the provider is asked nothing more, and plain DNS cannot look up the name.
    await use.click()
    await expect(use).not.toBeChecked()
    await expect.poll(saved).toEqual({ secureDnsMode: 'off', secureDnsTemplate: template })
    await window.getByRole('button', { name: 'Close settings' }).click()
    await openAddress(window, page('off.hronaut.test'))
    await expect.poll(
      () => window.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.pageProblem)'),
      { timeout: 30_000 }
    ).toMatchObject({ kind: 'load-error', errorDescription: 'ERR_NAME_NOT_RESOLVED' })
    expect(asked).not.toContain('off.hronaut.test')

    // On again, it starts with the DNS service's own secure DNS, and the provider typed in becomes the one asked.
    await window.getByRole('button', { name: 'Settings' }).click()
    await window.getByRole('button', { name: /Workspaces & data/ }).click()
    await use.click()
    await expect(choice).toHaveValue('automatic')
    await expect.poll(saved).toEqual({ secureDnsMode: 'automatic', secureDnsTemplate: template })
    await choice.selectOption({ label: 'Custom' })
    await expect(field).toHaveValue(template)
    await expect(field).toHaveAccessibleDescription('Addresses are looked up as before until you press Use.')
    await field.click()
    await window.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
    await window.keyboard.type(` ${template} `)
    await window.keyboard.press('Enter')
    await expect.poll(saved).toEqual({ secureDnsMode: 'secure', secureDnsTemplate: template })
    await expect(field).toHaveValue(template)
    await window.getByRole('button', { name: 'Close settings' }).click()
    await openAddress(window, page('custom.hronaut.test'))
    await expect(window.getByRole('tab', { name: /Found custom\.hronaut\.test/ })).toBeVisible()
    await expect.poll(async () => await readFile(join(profileDirectory, 'tabs.json'), 'utf8').catch(() => ''))
      .toContain('custom.hronaut.test')

    // After a restart, the tab Hronaut opens again is looked up through the provider too: the setting is applied
    // before the first page loads.
    await closeHronaut(instance.app)
    instance = undefined
    asked.length = 0
    instance = await launch()
    window = instance.window
    await expect.poll(
      () => window.evaluate('window.hronaut.getState().then((state) => { const tab = state.tabs.find((candidate) => candidate.active); return tab && { title: tab.title, loading: tab.loading, problem: tab.pageProblem ?? null } })'),
      { timeout: 30_000 }
    ).toEqual({ title: 'Found custom.hronaut.test', loading: false, problem: null })
    expect(asked).toContain('custom.hronaut.test')
  } finally {
    if (instance) await closeHronaut(instance.app)
    if (provider) await closeFixtureServer(provider)
    await closeFixtureServer(website)
    await rm(certificates, { recursive: true, force: true })
  }
})

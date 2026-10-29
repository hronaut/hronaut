import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { closeFixtureServer, expect, test } from './fixtures.js'
import { answerTrustedDialog, trustedDialog, trustedDialogHeadline } from './trusted-dialog-fixture.js'

const exec = promisify(execFile)

type ActiveTab = { title: string; url: string; untrustedCertificate?: true; pageProblem?: { certificate?: { host: string; canProceed: boolean } } }

test('refuses a website whose certificate is not trusted, as Chrome does, and opens it only once the person chooses to proceed', async ({ appWindow }) => {
  const certificates = await mkdtemp(join(tmpdir(), 'hronaut-certificate-'))
  let server: ReturnType<typeof createServer> | undefined
  let framing: ReturnType<typeof createHttpServer> | undefined
  const activeTab = () => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active))') as Promise<ActiveTab>
  try {
    // A certificate this computer does not trust, as a staging server's self-signed one.
    await exec('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
      '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', join(certificates, 'key.pem'), '-out', join(certificates, 'cert.pem')
    ])
    server = createServer({ key: await readFile(join(certificates, 'key.pem')), cert: await readFile(join(certificates, 'cert.pem')) }, (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Staging page</title>Signed in')
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const page = `https://127.0.0.1:${(server.address() as AddressInfo).port}/login`
    await appWindow.evaluate(url => { void (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }) }, page)

    // Chrome's privacy error, from which the person may open the page anyway: the website does not ask for HSTS.
    const problem = appWindow.locator('.page-problem-bar')
    await expect(problem).toContainText('Your connection is not private')
    await expect(problem).toContainText('Someone might be trying to steal your information from 127.0.0.1')
    await expect.poll(async () => (await activeTab()).title).toBe('Privacy error')
    // The address bar says the page is not secure, as Chrome does.
    expect((await activeTab()).untrustedCertificate).toBe(true)
    await expect(appWindow.getByRole('button', { name: 'Not secure. Site controls for 127.0.0.1' })).toBeVisible()
    const proceed = appWindow.getByTestId('page-problem-proceed')
    await expect(proceed).toHaveText('Proceed to 127.0.0.1…')

    // Hronaut's own dialog asks first; Back to safety changes nothing.
    await proceed.click()
    const dialog = trustedDialog(appWindow)
    await expect(dialog).toHaveAttribute('data-variant', 'certificate')
    expect(await trustedDialogHeadline(appWindow)).toBe('Proceed to 127.0.0.1?')
    await expect(dialog).toContainText('Its security certificate is not from an authority this computer trusts.')
    await expect(dialog.getByRole('button', { name: 'Back to safety' })).toBeFocused()
    await answerTrustedDialog(appWindow, 'Back to safety')
    await expect(dialog).toBeHidden()
    await expect(problem).toContainText('Your connection is not private')

    // Proceeding opens the page, which the address bar marks as not secure.
    await proceed.click()
    await answerTrustedDialog(appWindow, 'Proceed (unsafe)')
    await expect.poll(async () => (await activeTab()).title).toBe('Staging page')
    await expect(problem).toBeHidden()
    expect(await activeTab()).toMatchObject({ url: page, untrustedCertificate: true })
    await expect(appWindow.getByRole('button', { name: 'Not secure. Site controls for 127.0.0.1' })).toBeVisible()

    // The workspace's other pages on the website open without asking until Hronaut quits.
    await appWindow.evaluate(url => { void (window as unknown as { hronaut: { navigate(options: { url: string }): Promise<unknown> } }).hronaut.navigate({ url }) }, page.replace('/login', '/next'))
    await expect.poll(async () => (await activeTab()).url).toBe(page.replace('/login', '/next'))
    await expect.poll(async () => (await activeTab()).title).toBe('Staging page')
    await expect(dialog).toBeHidden()

    // Another website's page that shows a frame of that website is not secure either.
    framing = createHttpServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' }).end(`<title>Dashboard</title><iframe src="${page.replace('/login', '/frame')}"></iframe>`)
    })
    await new Promise<void>(resolve => framing!.listen(0, '127.0.0.1', resolve))
    const dashboard = `http://localhost:${(framing.address() as AddressInfo).port}/`
    await appWindow.evaluate(url => { void (window as unknown as { hronaut: { navigate(options: { url: string }): Promise<unknown> } }).hronaut.navigate({ url }) }, dashboard)
    await expect.poll(async () => (await activeTab()).title).toBe('Dashboard')
    await expect.poll(async () => (await activeTab()).untrustedCertificate).toBe(true)
    await expect(appWindow.getByRole('button', { name: 'Not secure. Site controls for localhost' })).toBeVisible()
  } finally {
    if (server) await closeFixtureServer(server)
    if (framing) await closeFixtureServer(framing)
    await rm(certificates, { recursive: true, force: true })
  }
})

test('learns from Chromium whether a website accepts only secure connections without connecting to it', async ({ electronApp }) => {
  // What Hronaut asks before it offers to proceed: a plain request to port 1, which Chromium never connects to.
  const outcome = (url: string) => electronApp.evaluate(({ net }, address) => new Promise<string>((resolve) => {
    const request = net.request({ url: address, redirect: 'manual' })
    request.on('redirect', (_status, _method, redirectUrl) => {
      resolve(`redirect ${redirectUrl}`)
      request.abort()
    })
    request.on('error', (error) => resolve(`error ${error.message}`))
    request.on('response', () => {
      resolve('response')
      request.abort()
    })
    request.end()
  }), url)
  // .dev is on Chromium's HSTS preload list, so Chromium answers with its own redirect to HTTPS before anything else.
  expect(await outcome('http://hronaut-probe.dev:1/')).toMatch(/^redirect https:\/\/hronaut-probe\.dev(:1)?\/$/)
  expect(await outcome('http://127.0.0.1:1/')).toBe('error net::ERR_UNSAFE_PORT')
})

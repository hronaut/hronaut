import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'

const FIXTURE_DIRECTORY = fileURLToPath(new URL('../fixtures/reown-appkit-shop/', import.meta.url))

let bundle: string | undefined

/**
 * Installs the shop's own pinned dependencies once, when the checkout has none (the Docker test image has them). npm
 * writes node_modules/.package-lock.json last, so an interrupted install is redone; one worker installs at a time.
 */
function installShopDependencies(): void {
  const installed = `${FIXTURE_DIRECTORY}node_modules/.package-lock.json`
  const lock = `${FIXTURE_DIRECTORY}.install-lock`
  const wait = new Int32Array(new SharedArrayBuffer(4))
  for (const deadline = Date.now() + 5 * 60_000; !existsSync(installed);) {
    try {
      mkdirSync(lock)
    } catch {
      if (Date.now() > deadline) throw new Error('Another test worker did not finish installing the Reown AppKit shop fixture within 5 minutes')
      // A lock left by a worker that died mid-install is taken over after 5 minutes.
      try { if (Date.now() - statSync(lock).mtimeMs > 5 * 60_000) rmSync(lock, { recursive: true, force: true }) } catch { /* Gone meanwhile. */ }
      Atomics.wait(wait, 0, 0, 500)
      continue
    }
    try {
      if (!existsSync(installed)) execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: FIXTURE_DIRECTORY, stdio: 'inherit' })
    } finally {
      rmSync(lock, { recursive: true, force: true })
    }
  }
}

/** The shop's browser bundle, built once per test worker from its own pinned dependencies. */
function shopBundle(): string {
  if (bundle) return bundle
  installShopDependencies()
  bundle = execFileSync(process.execPath, ['build.mjs'], { cwd: FIXTURE_DIRECTORY, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return bundle
}

export interface ReownShop {
  url: string
  origin: string
  close(): void
}

/**
 * Serves a shop page built on Reown AppKit and its wagmi adapter, which pays a merchant in ETH or in a 6-decimal
 * token on a local chain (ID 31337). AppKit's own button opens its connect modal; the page logs each payment.
 */
export async function startReownShop(options: { rpcUrl: string; token: string; merchant: string }): Promise<ReownShop> {
  const script = shopBundle()
  // AppKit needs a Reown project ID; no Reown service is needed for an installed wallet, so any well-formed ID works.
  const config = { ...options, projectId: 'f0e1d2c3b4a5968778695a4b3c2d1e0f' }
  const page = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Hronaut QA shop</title></head>
<body>
  <h1>Hronaut QA shop</h1>
  <appkit-button></appkit-button>
  <p id="status">Not connected</p>
  <button id="pay-token">Pay 5 QAUSD</button>
  <button id="pay-eth">Pay 0.01 ETH</button>
  <button id="pay-too-much">Pay 500 QAUSD</button>
  <h2>Payments</h2>
  <ol id="log"></ol>
  <script>window.__shopConfig = ${JSON.stringify(config)}</script>
  <script type="module" src="/shop.js"></script>
</body>
</html>`
  const server = createServer((request, response) => {
    if (request.url === '/shop.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
      response.end(script)
      return
    }
    if (request.url === '/' || request.url?.startsWith('/?')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(page)
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { url: `${origin}/`, origin, close: () => server.close() }
}

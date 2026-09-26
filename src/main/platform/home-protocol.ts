import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HomePageOptions } from '../../shared/home.js'
import { renderHomePage } from '../home-page.js'

interface HomeProtocolPorts {
  rendererDirectory: string
  developmentOrigin?: string
  state(): HomePageOptions
}
interface ManifestEntry { file: string; css?: string[]; imports?: string[] }

/** Only this protocol's trusted, isolated session receives the Home bootstrap. */
export function createHomeProtocolHandler(ports: HomeProtocolPorts): (request: Request) => Promise<Response> {
  let assets: Promise<{ script: string; styles: string[] }> | undefined
  function loadAssets(): Promise<{ script: string; styles: string[] }> {
    if (ports.developmentOrigin) return Promise.resolve({ script: '/src/home.ts', styles: [] })
    return assets ??= readFile(join(ports.rendererDirectory, '.vite/manifest.json'), 'utf8').then(source => {
      const manifest = JSON.parse(source) as Record<string, ManifestEntry>
      const entry = manifest['src/home.ts']
      if (!entry) throw new Error('Home renderer entry was not built')
      const styles = new Set<string>()
      const visited = new Set<string>()
      function collect(key: string): void {
        if (visited.has(key)) return
        visited.add(key)
        const item = manifest[key]
        item?.imports?.forEach(collect)
        item?.css?.forEach(path => styles.add(`/${path}`))
      }
      collect('src/home.ts')
      return { script: `/${entry.file}`, styles: [...styles] }
    })
  }
  return async request => {
    const url = new URL(request.url)
    if (url.protocol !== 'hronaut:' || url.hostname !== 'home' || request.method !== 'GET') return new Response('Not found', { status: 404 })
    if (url.pathname === '/api/status') return Response.json(ports.state().initialState, { headers: { 'cache-control': 'no-store' } })
    if (url.pathname === '/' || url.pathname === '') {
      return new Response(renderHomePage(ports.state(), await loadAssets()), { headers: {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; style-src hronaut://home 'unsafe-inline'; script-src hronaut://home; connect-src hronaut://home; img-src hronaut://home data:; font-src hronaut://home"
      } })
    }
    if (ports.developmentOrigin && /^\/(?:src\/|@|node_modules\/)/.test(url.pathname)) {
      // Vite transforms only renderer modules in development. Keep the document
      // origin and the preload trust check on hronaut://home.
      const response = await fetch(new URL(`${url.pathname}${url.search}`, ports.developmentOrigin))
      return new Response(await response.arrayBuffer(), { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'text/javascript', 'cache-control': 'no-store' } })
    }
    const asset = /^\/assets\/([a-zA-Z0-9_.-]+\.(js|css|png|woff2))$/.exec(url.pathname)
    if (!asset) return new Response('Not found', { status: 404 })
    try {
      const bytes = await readFile(join(ports.rendererDirectory, 'assets', asset[1]!))
      const mime = { js: 'text/javascript', css: 'text/css', png: 'image/png', woff2: 'font/woff2' }[asset[2] as 'js' | 'css' | 'png' | 'woff2']
      return new Response(bytes, { headers: { 'content-type': mime, 'cache-control': 'no-store' } })
    } catch { return new Response('Not found', { status: 404 }) }
  }
}

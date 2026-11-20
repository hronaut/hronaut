// Bundles the shop for the browser and writes it to stdout, so parallel tests never share an output file.
import { build } from 'esbuild'

const result = await build({
  entryPoints: [new URL('./shop.js', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  // Only AppKit's Coinbase and Safe connectors load it, and the shop turns them off.
  external: ['@wagmi/connectors'],
  logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  write: false
})
process.stdout.write(result.outputFiles[0].text)

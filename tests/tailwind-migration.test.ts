import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Tailwind styling boundary', () => {
  it('uses the Tailwind Vite plugin for the renderer and Storybook', async () => {
    const [packageJson, electronConfig, storybookConfig] = await Promise.all([
      source('package.json'),
      source('electron.vite.config.ts'),
      source('.storybook/main.ts')
    ])

    expect(packageJson).toMatch(/"tailwindcss"/u)
    expect(packageJson).toMatch(/"@tailwindcss\/vite"/u)
    expect(electronConfig).toMatch(/import tailwindcss from '@tailwindcss\/vite'/u)
    expect(electronConfig).toMatch(/plugins:\s*\[tailwindcss\(\),\s*vue\(\)/u)
    expect(storybookConfig).toContain('tailwindcss(), vue()]')
  })

  it('keeps Tailwind scoped to renderer utilities without global Preflight', async () => {
    const [rendererStyles, overlayStyles] = await Promise.all([
      source('src/renderer/src/styles.css'),
      source('src/renderer/src/address-overlay.css')
    ])

    for (const styles of [rendererStyles, overlayStyles]) {
      expect(styles).toContain('@import "tailwindcss/theme.css"')
      expect(styles).toContain('@import "tailwindcss/utilities.css"')
      expect(styles).toContain('@theme inline')
      expect(styles).not.toContain('tailwindcss/preflight.css')
    }
  })

  it('expresses application styling through Tailwind composition', async () => {
    const files = [
      'src/renderer/src/address-overlay.css',
      'src/renderer/src/styles/base.css',
      'src/renderer/src/styles/collections.css',
      'src/renderer/src/styles/dialogs.css',
      'src/renderer/src/styles/panels.css',
      'src/renderer/src/styles/primitives.css',
      'src/renderer/src/styles/settings.css',
      'src/renderer/src/styles/shell.css',
      'src/renderer/src/styles/title-bar.css',
      'src/renderer/src/styles/tools.css'
    ]
    const styles = (await Promise.all(files.map(source))).join('\n')

    expect(styles.match(/@apply\s+/gu)?.length ?? 0).toBeGreaterThan(2_000)
    expect(styles).toContain('@apply inline-flex')
    expect(styles).toContain('@apply grid')
  })
})

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const outputPath = resolve(
  process.argv[2] ?? join(repositoryRoot, '..', 'hronaut-page', 'public', 'hronaut-app.png')
)
const profileDirectory = await mkdtemp(join(tmpdir(), 'hronaut-marketing-'))

try {
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(
    join(profileDirectory, 'settings.json'),
    `${JSON.stringify({ interfaceScale: 1, languagePreference: 'en-US', theme: 'dark' }, null, 2)}\n`,
    'utf8'
  )

  const app = await electron.launch({
    args: ['.'],
    cwd: repositoryRoot,
    env: {
      ...process.env,
      HRONAUT_DISABLE_AUTO_UPDATE: '1',
      HRONAUT_DISABLE_MCP_AUTH: '1',
      HRONAUT_DOWNLOAD_DIR: profileDirectory,
      HRONAUT_MCP_HOST: '127.0.0.1',
      HRONAUT_MCP_PORT: '48729',
      HRONAUT_USER_DATA_DIR: profileDirectory
    }
  })

  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.setViewportSize({ width: 1440, height: 900 })
    await window.getByRole('button', { name: 'Open Hronaut Home' }).click()
    await window.waitForTimeout(1_000)
    const imageBase64 = await app.evaluate(async ({ webContents }) => {
      const home = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().startsWith('hronaut://home'))
      if (!home) throw new Error('Hronaut Home was not available for capture')
      const image = await home.capturePage()
      return image.toPNG().toString('base64')
    })
    await writeFile(outputPath, Buffer.from(imageBase64, 'base64'))
    console.log(outputPath)
  } finally {
    await app.close()
  }
} finally {
  await rm(profileDirectory, { recursive: true, force: true })
}

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function seedPackagedMcpSmokeProfile(profileDirectory) {
  await writeFile(
    join(profileDirectory, 'settings.json'),
    `${JSON.stringify({ mcpToolSet: 'complete' }, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 }
  )
}

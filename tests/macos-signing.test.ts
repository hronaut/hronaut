import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const run = promisify(execFile)

interface WorkflowStep { name?: string, if?: string, env?: Record<string, string>, run?: string }
interface WorkflowJob {
  environment?: string
  env?: Record<string, string>
  steps: WorkflowStep[]
  strategy?: { matrix?: { include?: Array<Record<string, unknown>> } }
}
interface Workflow { jobs: Record<string, WorkflowJob> }

async function workflow(path: string): Promise<Workflow> {
  return parse(await readFile(path, 'utf8')) as Workflow
}

const SIGNING_ENV = {
  CSC_LINK: '${{ secrets.MAC_CSC_LINK }}',
  CSC_KEY_PASSWORD: '${{ secrets.MAC_CSC_KEY_PASSWORD }}',
  APPLE_API_KEY_P8: '${{ secrets.APPLE_API_KEY_P8 }}',
  APPLE_API_KEY_ID: '${{ secrets.APPLE_API_KEY_ID }}',
  APPLE_API_ISSUER: '${{ secrets.APPLE_API_ISSUER }}'
}

/** The step that runs this exact command line, failing when there is none. */
function stepRunning(job: WorkflowJob, line: string): { step: WorkflowStep, index: number } {
  const index = job.steps.findIndex(step => step.run?.split('\n').map(part => part.trim()).includes(line))
  expect(index, line).toBeGreaterThanOrEqual(0)
  return { step: job.steps[index]!, index }
}

/** Only these steps of a job may hold the signing secrets: the check and the packaging. */
function expectSecretsOnlyIn(job: WorkflowJob, allowed: WorkflowStep[]): void {
  for (const step of job.steps) {
    const holdsSecret = Object.values(step.env ?? {}).some(value => value.includes('secrets.'))
    expect(holdsSecret, step.name ?? step.run).toBe(allowed.includes(step))
  }
  expect(job.env ?? {}).not.toEqual(expect.objectContaining({ CSC_LINK: expect.anything() }))
}

describe('signed and notarized macOS packages', () => {
  it('signs the app with the hardened runtime and only the entitlements Hronaut needs, and signs the disk images', async () => {
    const config = parse(await readFile('electron-builder.yml', 'utf8')) as { mac: Record<string, unknown> & { extendInfo: Record<string, string> }, dmg: Record<string, unknown> }
    // `identity: null` turned signing off.
    expect(config.mac).not.toHaveProperty('identity')
    expect(config.mac).toMatchObject({
      hardenedRuntime: true,
      notarize: true,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.plist'
    })
    // Each device a website can ask for has its usage description, which macOS shows when Hronaut first asks.
    expect(Object.keys(config.mac.extendInfo).sort()).toEqual(['NSCameraUsageDescription', 'NSLocationUsageDescription', 'NSMicrophoneUsageDescription'])
    expect(config.dmg.sign).toBe(true)
    // The disk image is stapled after electron-builder would write its blockmap; updates come from the zip.
    expect(config.dmg.writeUpdateInfo).toBe(false)
    const entitlements = await readFile('build/entitlements.mac.plist', 'utf8')
    const dict = /<plist version="1\.0">\s*<dict>([\s\S]*)<\/dict>\s*<\/plist>\s*$/u.exec(entitlements)?.[1] ?? ''
    // Every entry is a key set to true; anything else in the dictionary would go unchecked here.
    const withoutComments = dict.replace(/<!--[\s\S]*?-->/gu, '')
    const entries = [...withoutComments.matchAll(/<key>([^<]+)<\/key>\s*<true\/>/gu)]
    expect(withoutComments.replace(/<key>[^<]+<\/key>\s*<true\/>/gu, '').trim()).toBe('')
    expect(entries.map(match => match[1])).toEqual([
      'com.apple.security.cs.allow-jit',
      'com.apple.security.device.camera',
      'com.apple.security.device.audio-input',
      'com.apple.security.personal-information.location'
    ])
  })

  it('builds a macOS release only when it can be signed, with the secrets kept from the install and build', async () => {
    const release = await workflow('.github/workflows/release.yml')
    const job = release.jobs['build-macos']!
    expect(job.environment).toBe('macos-signing')
    const check = stepRunning(job, 'bash scripts/sign-check-macos.sh')
    const install = stepRunning(job, 'npm ci')
    const build = stepRunning(job, 'npm run build:app')
    const packaging = stepRunning(job, 'npx electron-builder --mac "$PACKAGE_TARGET" --x64 --arm64 --publish never -c.mac.forceCodeSigning=true')
    const verify = stepRunning(job, 'bash scripts/notarize-and-verify-macos.sh')
    expect(check.index).toBeLessThan(install.index)
    expect(build.index).toBeLessThan(packaging.index)
    expect(verify.step).toBe(packaging.step)
    expect(check.step.env).toEqual(SIGNING_ENV)
    expect(packaging.step.env).toMatchObject(SIGNING_ENV)
    expectSecretsOnlyIn(job, [check.step, packaging.step])
    const script = packaging.step.run!
    expect(script.indexOf('npx electron-builder --mac')).toBeLessThan(script.indexOf('bash scripts/notarize-and-verify-macos.sh'))
    expect(script).toContain('trap \'rm -f "$APPLE_API_KEY"\' EXIT')
    expect(script).toContain('(umask 077 && printf \'%s\\n\' "$APPLE_API_KEY_P8" > "$APPLE_API_KEY")')
    // The disk image's blockmap described it before stapling and is no longer written or published.
    expect(job.strategy?.matrix?.include).toEqual(expect.arrayContaining([expect.objectContaining({ target: 'dmg', files: 'dist/*.dmg\n' })]))
    // Windows packages stay unsigned.
    const windows = release.jobs['build-windows']!.steps.find(step => step.name?.startsWith('Build unsigned Windows'))
    expect(windows?.env?.CSC_IDENTITY_AUTO_DISCOVERY).toBe('false')
  })

  it('signs and notarizes the Mac packages of the rehearsal as its release does, in their own job', async () => {
    const ci = await workflow('.github/workflows/ci.yml')
    const mac = ci.jobs['package-macos-release-candidate']!
    expect(mac).toMatchObject({ environment: 'macos-signing', 'runs-on': 'macos-latest', if: "github.event_name == 'workflow_dispatch' && startsWith(github.ref_name, 'release/')" })
    const check = stepRunning(mac, 'bash scripts/sign-check-macos.sh')
    const install = stepRunning(mac, 'npm ci')
    const build = stepRunning(mac, 'npm run build:app')
    const packaging = stepRunning(mac, 'npx electron-builder --mac --publish never -c.mac.forceCodeSigning=true')
    expect(stepRunning(mac, 'bash scripts/notarize-and-verify-macos.sh').step).toBe(packaging.step)
    expect([check.index, install.index, build.index, packaging.index]).toEqual([...[check.index, install.index, build.index, packaging.index]].sort((a, b) => a - b))
    expectSecretsOnlyIn(mac, [check.step, packaging.step])
    // The other platforms' rehearsal stays unsigned and has no Mac leg left.
    const others = ci.jobs['package-release-candidate']!
    expect(others.env?.CSC_IDENTITY_AUTO_DISCOVERY).toBe('false')
    expect(others.strategy?.matrix?.include?.map(entry => entry.os)).toEqual(['ubuntu-latest', 'windows-latest'])
    expectSecretsOnlyIn(others, [])
  })

  it('stops before building when any signing or notarization secret is empty', async () => {
    const complete = { CSC_LINK: 'cert', CSC_KEY_PASSWORD: 'password', APPLE_API_KEY_P8: 'key', APPLE_API_KEY_ID: 'id', APPLE_API_ISSUER: 'issuer' }
    await expect(run('bash', ['scripts/sign-check-macos.sh'], { env: { PATH: process.env.PATH, ...complete } })).resolves.toBeDefined()
    const failed = await run('bash', ['scripts/sign-check-macos.sh'], {
      env: { PATH: process.env.PATH, ...complete, CSC_KEY_PASSWORD: '', APPLE_API_ISSUER: '' }
    }).then(() => undefined, (error: { code?: number, stdout?: string }) => error)
    expect(failed?.code).toBe(1)
    expect(failed?.stdout).toContain('these values are empty: CSC_KEY_PASSWORD APPLE_API_ISSUER')
  })
})

/**
 * Runs scripts/notarize-and-verify-macos.sh against a stand-in dist/ with stand-ins for Apple's tools on PATH. What
 * each tool answers comes from the environment; every call is written to calls.log.
 */
describe('notarizing the disk images and checking what Gatekeeper will check', () => {
  let root: string
  const script = resolve('scripts/notarize-and-verify-macos.sh')

  const STUBS: Record<string, string> = {
    xcrun: `echo "xcrun $*" >> "$STUB_LOG"
case "$1 $2" in
  "notarytool submit") echo "{\\"id\\":\\"submission-1\\",\\"status\\":\\"$STUB_NOTARY_STATUS\\"}" ;;
  "notarytool log") echo "notary log for $3" ;;
  "stapler staple"|"stapler validate") echo "The validate action worked!" ;;
esac`,
    codesign: `echo "codesign $*" >> "$STUB_LOG"
if [ "$1" = --display ]; then
  target="\${@: -1}"
  team="$STUB_APP_TEAM"; case "$target" in *.dmg) team="$STUB_DMG_TEAM" ;; esac
  if [ -n "$STUB_AUTHORITY" ]; then echo "Authority=$STUB_AUTHORITY" >&2; fi
  echo "TeamIdentifier=$team" >&2
fi`,
    spctl: `echo "spctl $*" >> "$STUB_LOG"
echo "\${@: -1}: accepted" >&2
echo "source=$STUB_SPCTL_SOURCE" >&2`
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'hronaut-notarize-'))
    await mkdir(join(root, 'bin'))
    for (const [name, body] of Object.entries(STUBS)) {
      await writeFile(join(root, 'bin', name), `#!/usr/bin/env bash\n${body}\n`)
      await chmod(join(root, 'bin', name), 0o755)
    }
    await mkdir(join(root, 'dist/mac/Hronaut.app'), { recursive: true })
    await mkdir(join(root, 'dist/mac-arm64/Hronaut.app'), { recursive: true })
    await writeFile(join(root, 'dist/hronaut-1.0.0-x64.dmg'), '')
    await writeFile(join(root, 'dist/hronaut-1.0.0-arm64.dmg'), '')
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  async function verify(answers: Record<string, string> = {}): Promise<{ code: number, output: string, calls: string[] }> {
    const env = {
      PATH: `${join(root, 'bin')}:${process.env.PATH}`,
      // Glob order, and so which package a failure names first, follows the locale.
      LC_ALL: 'C',
      STUB_LOG: join(root, 'calls.log'),
      APPLE_API_KEY: '/tmp/AuthKey.p8',
      APPLE_API_KEY_ID: 'KEY123',
      APPLE_API_ISSUER: 'issuer-uuid',
      STUB_NOTARY_STATUS: 'Accepted',
      STUB_AUTHORITY: 'Developer ID Application: Hronaut (TEAM123)',
      STUB_APP_TEAM: 'TEAM123',
      STUB_DMG_TEAM: 'TEAM123',
      STUB_SPCTL_SOURCE: 'Notarized Developer ID',
      ...answers
    }
    const result = await run('bash', [script], { cwd: root, env }).then(
      ({ stdout, stderr }) => ({ code: 0, output: stdout + stderr }),
      (error: { code?: number, stdout?: string, stderr?: string }) => ({ code: error.code ?? -1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` })
    )
    const calls = (await readFile(join(root, 'calls.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean)
    return { ...result, calls }
  }

  it('notarizes and staples each disk image, then checks both apps and images', async () => {
    const { code, output, calls } = await verify()
    expect(code, output).toBe(0)
    expect(output).toContain('Signed by team TEAM123 and notarized')
    expect(calls.filter(call => call.startsWith('xcrun notarytool submit'))).toEqual([
      'xcrun notarytool submit dist/hronaut-1.0.0-arm64.dmg --key /tmp/AuthKey.p8 --key-id KEY123 --issuer issuer-uuid --wait --output-format json',
      'xcrun notarytool submit dist/hronaut-1.0.0-x64.dmg --key /tmp/AuthKey.p8 --key-id KEY123 --issuer issuer-uuid --wait --output-format json'
    ])
    expect(calls).toEqual(expect.arrayContaining([
      'xcrun stapler staple dist/hronaut-1.0.0-x64.dmg',
      'codesign --verify --deep --strict --verbose=2 dist/mac/Hronaut.app',
      'codesign --verify --deep --strict --verbose=2 dist/mac-arm64/Hronaut.app',
      'xcrun stapler validate dist/mac/Hronaut.app',
      'spctl --assess --verbose=4 --type execute dist/mac/Hronaut.app',
      'spctl --assess --verbose=4 --type open --context context:primary-signature dist/hronaut-1.0.0-arm64.dmg',
      'xcrun stapler validate dist/hronaut-1.0.0-x64.dmg'
    ]))
    // Stapling comes before any check reads the images.
    expect(calls.findIndex(call => call === 'xcrun stapler staple dist/hronaut-1.0.0-x64.dmg'))
      .toBeLessThan(calls.findIndex(call => call === 'xcrun stapler validate dist/hronaut-1.0.0-x64.dmg'))
  })

  it('fails when Gatekeeper accepts a package without naming its notarization, as it does with assessments off', async () => {
    const { code, output } = await verify({ STUB_SPCTL_SOURCE: 'Developer ID\noverride=security disabled' })
    expect(code).toBe(1)
    expect(output).toContain('::error::Gatekeeper did not accept dist/mac-arm64/Hronaut.app as notarized Developer ID software')
  })

  it('fails with Apple’s log when a disk image is not notarized', async () => {
    const { code, output, calls } = await verify({ STUB_NOTARY_STATUS: 'Invalid' })
    expect(code).toBe(1)
    expect(output).toContain('::error::Apple did not notarize dist/hronaut-1.0.0-arm64.dmg: Invalid')
    expect(output).toContain('notary log for submission-1')
    expect(calls.some(call => call.startsWith('xcrun stapler'))).toBe(false)
  })

  it('fails for a signature that is not a Developer ID Application one', async () => {
    const { code, output } = await verify({ STUB_AUTHORITY: 'Apple Development: Someone (TEAM123)' })
    expect(code).toBe(1)
    expect(output).toContain('dist/mac-arm64/Hronaut.app is not signed with a Developer ID Application certificate')
  })

  it('fails when the apps and disk images were signed by different teams', async () => {
    const { code, output } = await verify({ STUB_DMG_TEAM: 'OTHER99' })
    expect(code).toBe(1)
    expect(output).toContain('::error::Expected every app and disk image signed by one team, found: OTHER99 TEAM123')
  })

  it('fails without both apps', async () => {
    await rm(join(root, 'dist/mac'), { recursive: true })
    const { code, output, calls } = await verify()
    expect(code).toBe(1)
    expect(output).toContain('Expected the x64 and arm64 Hronaut.app in dist/, found 1')
    expect(calls).toEqual([])
  })
})

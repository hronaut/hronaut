import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const run = promisify(execFile)

interface WorkflowStep { name?: string, if?: string, env?: Record<string, string>, run?: string }
interface Workflow { jobs: Record<string, { env?: Record<string, string>, steps: WorkflowStep[], strategy?: { matrix?: { include?: Array<Record<string, unknown>> } } }> }

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

describe('signed and notarized macOS packages', () => {
  it('signs the app with the hardened runtime and only the entitlements Hronaut needs, and signs the disk images', async () => {
    const config = parse(await readFile('electron-builder.yml', 'utf8')) as { mac: Record<string, unknown>, dmg: Record<string, unknown> }
    // `identity: null` turned signing off.
    expect(config.mac).not.toHaveProperty('identity')
    expect(config.mac).toMatchObject({
      hardenedRuntime: true,
      notarize: true,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.plist'
    })
    expect(config.dmg.sign).toBe(true)
    const entitlements = await readFile('build/entitlements.mac.plist', 'utf8')
    expect([...entitlements.matchAll(/<key>([^<]+)<\/key>\s*<true\/>/gu)].map(match => match[1])).toEqual([
      'com.apple.security.cs.allow-jit',
      'com.apple.security.device.camera',
      'com.apple.security.device.audio-input'
    ])
  })

  it('builds a macOS release only when it can be signed and notarized, and checks what Gatekeeper will check', async () => {
    const release = await workflow('.github/workflows/release.yml')
    const build = release.jobs['build-macos']!.steps.find(step => step.name?.startsWith('Build signed and notarized macOS'))
    expect(build?.env).toMatchObject(SIGNING_ENV)
    expect(build?.env).not.toHaveProperty('CSC_IDENTITY_AUTO_DISCOVERY')
    const script = build?.run ?? ''
    expect(script.indexOf('bash scripts/sign-check-macos.sh')).toBeGreaterThanOrEqual(0)
    expect(script.indexOf('bash scripts/sign-check-macos.sh')).toBeLessThan(script.indexOf('npm ci'))
    expect(script.indexOf('bash scripts/notarize-and-verify-macos.sh')).toBeGreaterThan(script.indexOf('npx electron-builder --mac'))
    expect(script).toContain('trap \'rm -f "$APPLE_API_KEY"\' EXIT')
    // Windows packages stay unsigned.
    const windows = release.jobs['build-windows']!.steps.find(step => step.name?.startsWith('Build unsigned Windows'))
    expect(windows?.env?.CSC_IDENTITY_AUTO_DISCOVERY).toBe('false')
  })

  it('signs and notarizes the macOS release candidate of the rehearsal as its release is', async () => {
    const ci = await workflow('.github/workflows/ci.yml')
    const candidate = ci.jobs['package-release-candidate']!
    expect(candidate.strategy?.matrix?.include).toEqual(expect.arrayContaining([
      expect.objectContaining({ os: 'macos-latest', command: 'package:mac', signed: true })
    ]))
    expect(candidate.strategy?.matrix?.include?.filter(entry => entry.signed)).toHaveLength(1)
    expect(candidate.env?.CSC_IDENTITY_AUTO_DISCOVERY).toBe("${{ matrix.signed && 'true' || 'false' }}")
    const unsigned = candidate.steps.find(step => step.name === 'Build release packages')
    const signed = candidate.steps.find(step => step.name === 'Build signed and notarized release packages')
    expect(unsigned?.if).toBe('${{ !matrix.signed }}')
    expect(signed?.if).toBe('${{ matrix.signed }}')
    expect(signed?.env).toMatchObject(SIGNING_ENV)
    expect(signed?.run).toContain('bash scripts/sign-check-macos.sh')
    expect(signed?.run).toContain('bash scripts/notarize-and-verify-macos.sh')
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

  it('notarizes the disk images and checks every signature, ticket and Gatekeeper verdict', async () => {
    const script = await readFile('scripts/notarize-and-verify-macos.sh', 'utf8')
    for (const check of [
      'xcrun notarytool submit "$image" --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait',
      'xcrun stapler staple "$image"',
      'codesign --verify --deep --strict --verbose=2 "$app"',
      "grep -F 'Authority=Developer ID Application:'",
      'xcrun stapler validate "$app"',
      'spctl --assess --type execute --verbose=4 "$app"',
      'xcrun stapler validate "$image"',
      'spctl --assess --type open --context context:primary-signature --verbose=4 "$image"'
    ]) expect(script).toContain(check)
  })
})

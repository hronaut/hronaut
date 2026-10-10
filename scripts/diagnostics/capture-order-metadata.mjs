// Fixed bounded metadata, never arbitrary command output in exported artifacts.
import { execFileSync } from 'node:child_process'
import { mkdirSync, statfsSync, writeFileSync } from 'node:fs'
import { availableParallelism, totalmem } from 'node:os'
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (!/^[0-9a-f]{40}$/.test(source)) throw new Error('Invalid source identity')
const rawDriver = execFileSync('docker', ['info', '--format', '{{.Driver}}'], { encoding: 'utf8' }).trim()
const driver = ['overlay2', 'overlayfs', 'vfs', 'btrfs', 'zfs'].includes(rawDriver) ? rawDriver : 'other'
const rawImage = process.env.CAPTURE_IMAGE_ID ?? ''
const image = /^sha256:[0-9a-f]{64}$/.test(rawImage) ? rawImage : 'unavailable'
const disk = statfsSync('/')
mkdirSync('ci-artifacts', { recursive: true })
writeFileSync('ci-artifacts/provenance.json', JSON.stringify({ source,
  originalSource: '6b999354e79595c69edf585ed3ce9c87d63758bf', driver, image,
  availableCpus: availableParallelism(), hostMemoryBytes: totalmem(), availableDiskBytes: disk.bavail * disk.bsize }))

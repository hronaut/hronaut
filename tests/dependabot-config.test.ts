import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface DependabotGroup {
  'dependency-type'?: string
  patterns?: string[]
  'update-types'?: string[]
}

interface DependabotUpdate {
  'package-ecosystem': string
  directory: string
  schedule: {
    interval: string
    day?: string
    time?: string
    timezone?: string
  }
  'open-pull-requests-limit': number
  groups?: Record<string, DependabotGroup>
}

interface DependabotConfig {
  version: number
  updates: DependabotUpdate[]
}

describe('Dependabot configuration', () => {
  const config = parse(
    fs.readFileSync(path.join(process.cwd(), '.github', 'dependabot.yml'), 'utf8')
  ) as DependabotConfig

  it('checks every dependency ecosystem weekly with a ten-PR queue', () => {
    expect(config.version).toBe(2)
    expect(config.updates.map((update) => update['package-ecosystem'])).toEqual([
      'npm',
      'docker',
      'github-actions'
    ])

    for (const update of config.updates) {
      expect(update.directory).toBe('/')
      expect(update.schedule).toMatchObject({
        interval: 'weekly',
        day: 'monday',
        timezone: 'Europe/Kyiv'
      })
      expect(update['open-pull-requests-limit']).toBe(10)
    }
  })

  it('groups compatible updates while keeping major upgrades isolated', () => {
    const npm = config.updates.find((update) => update['package-ecosystem'] === 'npm')
    expect(npm?.groups).toEqual({
      'production-minor-patch': {
        'dependency-type': 'production',
        patterns: ['*'],
        'update-types': ['minor', 'patch']
      },
      'development-minor-patch': {
        'dependency-type': 'development',
        patterns: ['*'],
        'update-types': ['minor', 'patch']
      }
    })

    for (const update of config.updates.slice(1)) {
      expect(Object.values(update.groups ?? {})).toEqual([
        {
          patterns: ['*'],
          'update-types': ['minor', 'patch']
        }
      ])
    }
  })
})

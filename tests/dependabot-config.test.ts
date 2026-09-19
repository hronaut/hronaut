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
  schedule?: {
    interval: string
    day?: string
    time?: string
    timezone?: string
  }
  'open-pull-requests-limit'?: number
  ignore?: Array<{ 'dependency-name': string; versions?: string[] }>
  groups?: Record<string, DependabotGroup>
  patterns?: string[]
  'multi-ecosystem-group'?: string
}

interface DependabotConfig {
  version: number
  'multi-ecosystem-groups': Record<
    string,
    {
      'open-pull-requests-limit': number
      schedule: NonNullable<DependabotUpdate['schedule']>
    }
  >
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
      'npm',
      'docker',
      'github-actions'
    ])

    for (const update of config.updates) {
      expect(update.directory).toBe('/')
      if (!update['multi-ecosystem-group']) {
        expect(update['open-pull-requests-limit']).toBe(10)
      } else {
        expect(update).not.toHaveProperty('open-pull-requests-limit')
      }
    }

    for (const update of config.updates.filter((update) => update.schedule)) {
      expect(update.schedule).toMatchObject({
        interval: 'weekly',
        day: 'monday',
        timezone: 'Europe/Kyiv'
      })
    }

    expect(config['multi-ecosystem-groups'].playwright).toEqual({
      'open-pull-requests-limit': 10,
      schedule: {
        interval: 'weekly',
        day: 'monday',
        time: '06:15',
        timezone: 'Europe/Kyiv'
      }
    })
  })

  it('groups compatible updates and keeps coupled Playwright versions together', () => {
    const npm = config.updates[0]
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
    expect(npm?.ignore).toEqual([
      { 'dependency-name': '@playwright/test' },
      { 'dependency-name': 'electron', versions: ['44.4.1'] }
    ])

    expect(config.updates.slice(1, 3)).toMatchObject([
      {
        'package-ecosystem': 'npm',
        patterns: ['@playwright/test'],
        'multi-ecosystem-group': 'playwright'
      },
      {
        'package-ecosystem': 'docker',
        patterns: ['mcr.microsoft.com/playwright'],
        'multi-ecosystem-group': 'playwright'
      }
    ])

    expect(config.updates[3]?.groups).toEqual({
      'actions-minor-patch': {
        patterns: ['*'],
        'update-types': ['minor', 'patch']
      }
    })
  })
})

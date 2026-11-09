import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface DependabotGroup {
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
  allow?: Array<{ 'dependency-name': string }>
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
    // One entry per ecosystem, so the Dependabot tab lists package.json once.
    expect(config.updates.map((update) => update['package-ecosystem'])).toEqual([
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

    expect(config['multi-ecosystem-groups']).toEqual({
      dependencies: {
        'open-pull-requests-limit': 10,
        schedule: {
          interval: 'weekly',
          day: 'monday',
          time: '06:00',
          timezone: 'Europe/Kyiv'
        }
      }
    })
  })

  it('updates every npm package with the Playwright Docker image in one pull request', () => {
    // Playwright and its Docker image move together, since tests/docker-playwright-version.test.ts keeps them equal.
    // Without an allow list, the Docker entry would open a pull request of its own for every other image it finds.
    expect(config.updates.slice(0, 2)).toEqual([
      {
        'package-ecosystem': 'npm',
        directory: '/',
        patterns: ['*'],
        'multi-ecosystem-group': 'dependencies',
        ignore: [{ 'dependency-name': 'typescript', versions: ['7.x'] }]
      },
      {
        'package-ecosystem': 'docker',
        directory: '/',
        allow: [{ 'dependency-name': 'mcr.microsoft.com/playwright' }],
        patterns: ['mcr.microsoft.com/playwright'],
        'multi-ecosystem-group': 'dependencies'
      }
    ])

    expect(config.updates[2]?.groups).toEqual({
      actions: {
        patterns: ['*']
      }
    })
  })
})

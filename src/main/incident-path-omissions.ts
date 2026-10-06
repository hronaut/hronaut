import type { IncidentKind, IncidentReviewInput } from '../shared/incident-package.js'

/** Resolve every literal path against parsed copies before removing any field. */
export function omitIncidentPaths(data: Map<IncidentKind, unknown>, rules: NonNullable<IncidentReviewInput['omitPaths']>): void {
  const targets: Array<{ parent: Record<string, unknown>; key: string }> = []
  for (const [index, rule] of rules.entries()) {
    const fail = (): never => { throw new Error(`Path omission ${index + 1} does not identify one available object property`) }
    for (const previous of rules.slice(0, index)) {
      if (previous.artifact === rule.artifact && previous.path.slice(0, Math.min(previous.path.length, rule.path.length))
        .every((segment, offset) => segment === rule.path[offset])) {
        throw new Error(`Path omission ${index + 1} duplicates or overlaps another rule`)
      }
    }
    let current = data.get(rule.artifact)
    for (const segment of rule.path.slice(0, -1)) {
      if (!current || typeof current !== 'object' || !Object.hasOwn(current, segment)) fail()
      if (Array.isArray(current)) {
        if (typeof segment !== 'number') return fail()
        current = current[segment]
      } else {
        if (typeof segment !== 'string') return fail()
        current = (current as Record<string, unknown>)[segment]
      }
    }
    const key = rule.path.at(-1)!
    if (!current || typeof current !== 'object' || Array.isArray(current) || typeof key !== 'string' || !Object.hasOwn(current, key)) fail()
    targets.push({ parent: current as Record<string, unknown>, key: key as string })
  }
  for (const { parent, key } of targets) delete parent[key]
}

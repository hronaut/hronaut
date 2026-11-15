import type { Plugin } from 'vite'

/**
 * Vue's DOM listeners skip an event that is not newer than the listener, and they read both times from the wall clock:
 * the first Vue listener an event reaches stamps it with Date.now(), and every other listener compares that stamp with
 * the Date.now() it read when it was attached. When the wall clock steps back, every listener attached before the step
 * ignores events until the clock passes its attach time again. A Linux machine whose firmware clock keeps local time
 * starts an hour or more ahead and is corrected soon after login, so Hronaut started at login drew its window and
 * answered agents, while the shell's root click guard stamped every click and the controls under it ignored them.
 * Both reads use the monotonic clock instead, which keeps Vue's comparison and never steps back.
 */
const WALL_CLOCK_READS: readonly RegExp[] = [
  /(cachedNow\s*=\s*)Date\.now\(\)/g,
  /(e\._vts\s*=\s*)Date\.now\(\)/g
]

/** Vue's DOM runtime with its listener times read from the monotonic clock; throws when Vue no longer reads them as expected. */
export function withMonotonicEventTime(source: string): string {
  let patched = source
  for (const read of WALL_CLOCK_READS) {
    const found = patched.match(read)?.length ?? 0
    if (found !== 1) throw new Error(`@vue/runtime-dom has ${found} matches for ${read}, expected 1; check how its event listeners read the time`)
    patched = patched.replace(read, '$1performance.now()')
  }
  return patched
}

const VUE_DOM_RUNTIME = /[\\/]@vue[\\/]runtime-dom[\\/]dist[\\/]runtime-dom\.esm-bundler\.js$/

/**
 * Applies withMonotonicEventTime to Vue's DOM runtime in the renderer build, and fails the build when no module it
 * bundled was Vue's DOM runtime. The development server pre-bundles Vue without it.
 */
export function vueMonotonicEventTime(): Plugin {
  let patched = false
  return {
    name: 'hronaut:vue-monotonic-event-time',
    apply: 'build',
    buildStart() {
      patched = false
    },
    transform(code, id) {
      if (!VUE_DOM_RUNTIME.test(id)) return null
      patched = true
      return { code: withMonotonicEventTime(code), map: null }
    },
    generateBundle() {
      if (!patched) this.error('The renderer bundle has no @vue/runtime-dom esm-bundler build to read event times from the monotonic clock')
    }
  }
}

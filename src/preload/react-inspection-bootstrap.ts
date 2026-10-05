/** Locally authored, version-scoped registration protocol; see docs/react-inspection.md.
 * This function is serialized into the main world. Keep all runtime dependencies
 * inside it and capture intrinsics before page scripts run. */
export function installReactInspection(installationId: string): void {
  const descriptor = Object.getOwnPropertyDescriptor;
  const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
  const freeze = Object.freeze;
  const roots = Object.create(null) as Record<number, unknown>;
  let rootCount = 0;
  const renderers = Object.create(null) as Record<number, unknown>;
  let rendererCount = 0;
  const ids = new WeakMap<object, number>();
  const weakGet = WeakMap.prototype.get.bind(ids);
  const weakSet = WeakMap.prototype.set.bind(ids);
  const epoch = installationId;
  let serial = 0;
  let revision = 0;
  let enabled = true;
  let state: 'renderer-not-observed' | 'hook-conflict' | 'unsupported-renderer' | 'root-limit' | 'disabled-reload-required' = 'renderer-not-observed';
  const fields = new Set(['current', 'child', 'sibling', 'tag', 'type', 'displayName', 'name', 'version', 'rendererPackageName']);
  const hasField = Set.prototype.has.bind(fields);
  const hookName = '__REACT_DEVTOOLS_GLOBAL_HOOK__';
  // Checking the descriptor does not invoke an existing hook getter.
  if (descriptor(globalThis, hookName)) state = 'hook-conflict';
  const api = freeze({
    status: () => ({ state, epoch, revision, roots: rootCount, renderers: rendererCount }),
    rendererAt: (index: number) => renderers[index],
    rootAt: (index: number) => roots[index],
    read: (object: object, field: string) => {
      // Primitive rejection avoids the page's mutable Error constructor or stack hooks.
      if (!hasField(field)) throw 'field outside topology scope';
      const value = descriptor(object, field);
      if (value && !hasOwn(value, 'value')) throw 'accessor excluded';
      return value?.value;
    },
    id: (object: object) => {
      let id = weakGet(object);
      if (!id) { id = ++serial; weakSet(object, id); }
      return `${epoch}/${revision}/${id}`;
    },
    disable: () => { enabled = false; for (let i=0;i<rootCount;i++) delete roots[i]; for (let i=0;i<rendererCount;i++) delete renderers[i]; rootCount=0; rendererCount=0; revision++; state = 'disabled-reload-required'; }
  });
  Object.defineProperty(globalThis, '__hronautReactInspection', { value: api });
  // The isolated preload dispatches only this fixed disable event; its handler
  // retains the original closure rather than looking up a writable global name.
  (globalThis as unknown as { addEventListener(name: string, listener: () => void, capture: boolean): void }).addEventListener('hronaut:react-inspection:disable', () => api.disable(), true);
  if (state === 'hook-conflict') return;
  Object.defineProperty(globalThis, hookName, { value: freeze({
    supportsFiber: true,
    inject: (renderer: unknown) => {
      if (!enabled) return 0;
      if (rendererCount >= 1) { if(state !== 'unsupported-renderer') revision++; state='unsupported-renderer'; return 0; }
      renderers[rendererCount++] = renderer;
      revision++;
      return rendererCount;
    },
    onCommitFiberRoot: (_renderer: unknown, root: unknown) => {
      if (!enabled) return;
      // Retain opaque identity only; never read root state, props, keys or text.
      let known = false;
      for (let i = 0; i < rootCount; i++) if (roots[i] === root) known = true;
      if (!known) {
        if (rootCount >= 16) { if(state !== 'root-limit') revision++; state='root-limit'; return; }
        roots[rootCount++] = root;
      }
      revision++;
    },
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {}
  }) });

}

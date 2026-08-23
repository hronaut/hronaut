export const DOM_CHANGES_LIMITS = {
  maxEntries: 200,
  maxSelectorChars: 512,
  maxAttributeNameChars: 64,
  maxTagNameChars: 64,
  maxTagsPerEntry: 8
} as const

export type DomChangesPageAction = 'start' | 'get' | 'stop' | 'clear'

export function domChangesPageScript(action: DomChangesPageAction): string {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const limits = ${JSON.stringify(DOM_CHANGES_LIMITS)};
    const key = '__hronautDomChangesV1';
    const bounded = (value, length) => String(value || '').slice(0, length);
    const safeName = (value, length) => bounded(value, length).replace(/[^a-zA-Z0-9_:.-]/g, '');
    const tagName = (node) => node && node.nodeType === Node.ELEMENT_NODE
      ? safeName(node.localName || node.nodeName, limits.maxTagNameChars).toLowerCase()
      : '';
    const selectorFor = (node) => {
      let current = node && node.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      const parts = [];
      while (current && parts.length < 6) {
        const tag = tagName(current);
        if (!tag) break;
        let index = 1;
        let sibling = current.previousElementSibling;
        while (sibling) {
          if (sibling.localName === current.localName) index += 1;
          sibling = sibling.previousElementSibling;
        }
        parts.unshift(tag + ':nth-of-type(' + index + ')');
        current = current.parentElement;
      }
      return bounded(parts.join(' > '), limits.maxSelectorChars) || 'document';
    };
    const empty = () => ({
      active: false,
      changeCount: 0,
      entries: [],
      truncated: false,
      droppedChanges: 0,
      summary: { childList: 0, attributes: 0, text: 0, addedNodes: 0, removedNodes: 0 }
    });
    const snapshot = (state) => ({
      startedAt: state.startedAt,
      ...(state.stoppedAt ? { stoppedAt: state.stoppedAt } : {}),
      active: state.active,
      changeCount: state.changeCount,
      entries: state.entries.map((entry) => ({ ...entry })),
      truncated: state.truncated,
      droppedChanges: state.droppedChanges,
      summary: { ...state.summary }
    });
    const previous = globalThis[key];
    if (action === 'clear') {
      previous?.observer?.disconnect();
      delete globalThis[key];
      return empty();
    }
    if (action === 'start') {
      previous?.observer?.disconnect();
      const startedAtMs = Date.now();
      const state = {
        startedAt: new Date(startedAtMs).toISOString(),
        startedAtMs,
        active: true,
        entries: [],
        changeCount: 0,
        truncated: false,
        droppedChanges: 0,
        summary: { childList: 0, attributes: 0, text: 0, addedNodes: 0, removedNodes: 0 },
        observer: null,
        recordMutations: null
      };
      const recordMutations = (records) => {
        if (!state.active) return;
        const batches = new Map();
        for (const record of records) {
          let kind;
          let target = selectorFor(record.target);
          let attributeName;
          let addedNodes = 0;
          let removedNodes = 0;
          let addedTags = [];
          let removedTags = [];
          if (record.type === 'childList') {
            kind = 'child-list';
            addedNodes = record.addedNodes.length;
            removedNodes = record.removedNodes.length;
            addedTags = Array.from(new Set(Array.from(record.addedNodes).map(tagName).filter(Boolean))).slice(0, limits.maxTagsPerEntry);
            removedTags = Array.from(new Set(Array.from(record.removedNodes).map(tagName).filter(Boolean))).slice(0, limits.maxTagsPerEntry);
            state.summary.childList += 1;
            state.summary.addedNodes += addedNodes;
            state.summary.removedNodes += removedNodes;
          } else if (record.type === 'attributes') {
            kind = 'attributes';
            attributeName = safeName(record.attributeName, limits.maxAttributeNameChars) || 'attribute';
            state.summary.attributes += 1;
          } else {
            kind = 'text';
            state.summary.text += 1;
          }
          state.changeCount += 1;
          const signature = [kind, target, attributeName || '', addedTags.join(','), removedTags.join(',')].join('|');
          const existing = batches.get(signature);
          if (existing) {
            existing.occurrences += 1;
            existing.addedNodes = (existing.addedNodes || 0) + addedNodes;
            existing.removedNodes = (existing.removedNodes || 0) + removedNodes;
          } else {
            batches.set(signature, {
              kind,
              target,
              occurrences: 1,
              ...(attributeName ? { attributeName } : {}),
              ...(addedNodes ? { addedNodes } : {}),
              ...(removedNodes ? { removedNodes } : {}),
              ...(addedTags.length ? { addedTags } : {}),
              ...(removedTags.length ? { removedTags } : {})
            });
          }
        }
        const occurredAtMs = Date.now();
        for (const batch of batches.values()) {
          if (state.entries.length >= limits.maxEntries) {
            state.truncated = true;
            state.droppedChanges += batch.occurrences;
            continue;
          }
          state.entries.push({
            index: state.entries.length + 1,
            occurredAt: new Date(occurredAtMs).toISOString(),
            elapsedMs: Math.max(0, occurredAtMs - state.startedAtMs),
            ...batch
          });
        }
      };
      const observer = new MutationObserver(recordMutations);
      observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      state.observer = observer;
      state.recordMutations = recordMutations;
      globalThis[key] = state;
      return snapshot(state);
    }
    const state = globalThis[key];
    if (!state) return empty();
    if (action === 'stop' && state.active) {
      const pending = state.observer?.takeRecords() || [];
      if (pending.length) state.recordMutations?.(pending);
      state.observer?.disconnect();
      state.active = false;
      state.stoppedAt = new Date().toISOString();
    }
    return snapshot(state);
  })()`
}

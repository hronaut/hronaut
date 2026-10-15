export const LIVE_REGION_LIMITS = {
  maxSelectorChars: 512,
  maxObservations: 100,
  maxObservationChars: 1_000,
  maxTotalChars: 50_000,
  maxNodesPerRead: 2_000,
  maxCallbacks: 10_000,
  maxDurationMs: 300_000
} as const

export type LiveRegionPageAction = 'start' | 'get' | 'stop' | 'clear'

export const LIVE_REGION_ERRORS = {
  'invalid-selector': 'The selector is not valid CSS',
  'not-found': 'No element matches the selector in the top-level document',
  'not-unique': 'The selector matches more than one element; use a selector that identifies exactly one region',
  'too-broad': 'Select one region inside the page, not the html, head or body element',
  'excluded-region': 'Form fields, editable content, frames, scripts and styles cannot be recorded'
} as const

export type LiveRegionErrorCode = keyof typeof LIVE_REGION_ERRORS

/**
 * Builds the isolated-world script that records the text of one selected region at each
 * MutationObserver callback. Reads are bounded by node and character budgets before any
 * whole-subtree string exists, and never touch form values, editable content, frames,
 * shadow roots, scripts or styles.
 */
export function liveRegionPageScript(action: LiveRegionPageAction, selector?: string): string {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const selector = ${JSON.stringify(selector ?? '')};
    const limits = ${JSON.stringify(LIVE_REGION_LIMITS)};
    const key = '__hronautLiveRegionV1';
    const excludedTags = new Set(['script', 'style', 'noscript', 'template', 'textarea', 'input', 'select', 'option', 'datalist', 'iframe', 'frame', 'frameset', 'object', 'embed', 'canvas', 'video', 'audio']);
    const blockTags = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'td', 'th', 'tr', 'ul']);
    const roles = new Set(['alert', 'log', 'marquee', 'progressbar', 'region', 'status', 'timer']);
    const editable = (element) => element.hasAttribute('contenteditable') && element.getAttribute('contenteditable') !== 'false';
    const excluded = (element) => excludedTags.has(element.localName) || editable(element);
    const token = (element, name, allowed) => {
      const value = String(element.getAttribute(name) || '').trim().toLowerCase();
      return allowed.includes(value) ? value : undefined;
    };
    const metadataFor = (element) => {
      const metadata = {};
      const role = String(element.getAttribute('role') || '').trim().toLowerCase().split(/\\s+/)[0];
      if (roles.has(role)) metadata.role = role;
      const live = token(element, 'aria-live', ['off', 'polite', 'assertive']);
      if (live) metadata.ariaLive = live;
      const atomic = token(element, 'aria-atomic', ['true', 'false']);
      if (atomic) metadata.ariaAtomic = atomic === 'true';
      const relevant = String(element.getAttribute('aria-relevant') || '').trim().toLowerCase().split(/\\s+/)
        .filter((value, index, values) => ['additions', 'removals', 'text', 'all'].includes(value) && values.indexOf(value) === index)
        .slice(0, 4);
      if (relevant.length) metadata.ariaRelevant = relevant;
      const busy = token(element, 'aria-busy', ['true', 'false']);
      if (busy) metadata.ariaBusy = busy === 'true';
      return metadata;
    };
    // Bounded depth-first read: the node and character budgets stop work before a whole-subtree string is built.
    const readText = (root) => {
      const rawBudget = limits.maxObservationChars * 2;
      let raw = '';
      let nodes = 0;
      let truncated = false;
      let node = root.firstChild;
      while (node && node !== root) {
        if (++nodes > limits.maxNodesPerRead) { truncated = true; break; }
        let descend = false;
        if (node.nodeType === Node.TEXT_NODE) {
          const remaining = rawBudget - raw.length;
          if (node.length > remaining) {
            raw += node.substringData(0, Math.max(0, remaining));
            truncated = true;
            break;
          }
          raw += node.data;
        } else if (node.nodeType === Node.ELEMENT_NODE && !excluded(node)) {
          if (blockTags.has(node.localName)) raw += ' ';
          descend = true;
        }
        if (descend && node.firstChild) { node = node.firstChild; continue; }
        while (node && node !== root && !node.nextSibling) {
          node = node.parentNode;
          if (node && node !== root && node.nodeType === Node.ELEMENT_NODE && blockTags.has(node.localName)) raw += ' ';
        }
        if (!node || node === root) break;
        node = node.nextSibling;
      }
      let text = raw.replace(/\\s+/g, ' ').trim();
      if (text.length > limits.maxObservationChars) {
        text = text.slice(0, limits.maxObservationChars);
        truncated = true;
      }
      return { text, empty: text.length === 0, truncated };
    };
    // The region can become editable, enter design mode or move into a shadow tree after start,
    // so eligibility is checked again before every read, not only when recording starts.
    const ineligible = (region) => {
      if (!region.isConnected) return 'detached';
      if (region.getRootNode() !== document || document.designMode === 'on' || region.isContentEditable === true) return 'excluded';
      let steps = 0;
      for (let element = region; element; element = element.parentElement) {
        if (++steps > limits.maxNodesPerRead || excluded(element)) return 'excluded';
      }
      return '';
    };
    // Mutations inside excluded descendants are not counted, so counts reveal nothing about typing there.
    const insideExcluded = (node, region) => {
      let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      let steps = 0;
      while (element && element !== region) {
        if (++steps > limits.maxNodesPerRead || excluded(element)) return true;
        element = element.parentElement;
      }
      return false;
    };
    const empty = () => ({ active: false, observations: [], callbackCount: 0, unchangedCallbacks: 0, totalChars: 0 });
    const snapshot = (state) => ({
      selector: state.selector,
      startedAt: state.startedAt,
      ...(state.stoppedAt ? { stoppedAt: state.stoppedAt, stopReason: state.stopReason } : {}),
      active: state.active,
      metadata: { ...state.metadata },
      initial: { ...state.initial },
      observations: state.observations.map((observation) => ({ ...observation })),
      callbackCount: state.callbackCount,
      unchangedCallbacks: state.unchangedCallbacks,
      totalChars: state.totalChars
    });
    // Stopping disconnects the observer and drops the element reference, so a later read can never rebind.
    const stop = (state, reason) => {
      if (!state.active) return;
      state.active = false;
      state.observer.disconnect();
      state.observer = null;
      clearTimeout(state.timer);
      state.region = null;
      state.stoppedAt = new Date().toISOString();
      state.stopReason = reason;
    };
    const previous = globalThis[key];
    if (previous) {
      const reason = previous.active ? ineligible(previous.region) : '';
      if (reason) stop(previous, reason);
      if (previous.active && Date.now() - previous.startedAtMs >= limits.maxDurationMs) stop(previous, 'expired');
    }
    if (action === 'clear') {
      if (previous) stop(previous, 'stopped');
      delete globalThis[key];
      return empty();
    }
    if (action === 'get') return previous ? snapshot(previous) : empty();
    if (action === 'stop') {
      if (!previous) return empty();
      stop(previous, 'stopped');
      return snapshot(previous);
    }
    if (previous) stop(previous, 'stopped');
    delete globalThis[key];
    if (!selector || selector.length > limits.maxSelectorChars) return { error: 'invalid-selector' };
    let matches;
    try {
      matches = document.querySelectorAll(selector);
    } catch {
      return { error: 'invalid-selector' };
    }
    if (matches.length === 0) return { error: 'not-found' };
    if (matches.length > 1) return { error: 'not-unique' };
    const region = matches[0];
    if (region === document.documentElement || region === document.head || region === document.body) return { error: 'too-broad' };
    if (ineligible(region)) return { error: 'excluded-region' };
    const startedAtMs = Date.now();
    const startedAtPerf = performance.now();
    const initial = readText(region);
    const state = {
      selector,
      region,
      startedAt: new Date(startedAtMs).toISOString(),
      startedAtMs,
      active: true,
      metadata: metadataFor(region),
      initial,
      observations: [],
      callbackCount: 0,
      unchangedCallbacks: 0,
      totalChars: initial.text.length,
      lastText: initial.text,
      lastTruncated: initial.truncated,
      observer: null,
      timer: 0
    };
    state.observer = new MutationObserver((records) => {
      if (!state.active) return;
      const reason = ineligible(state.region);
      if (reason) { stop(state, reason); return; }
      const relevant = records.filter((record) => !insideExcluded(record.target, state.region));
      if (!relevant.length) return;
      state.callbackCount += 1;
      if (state.callbackCount > limits.maxCallbacks) { stop(state, 'callback-limit'); return; }
      const read = readText(state.region);
      // Only the bounded text is observable; a change beyond it reads as unchanged.
      if (read.text === state.lastText && read.truncated === state.lastTruncated) { state.unchangedCallbacks += 1; return; }
      if (state.totalChars + read.text.length > limits.maxTotalChars) { stop(state, 'total-char-limit'); return; }
      state.lastText = read.text;
      state.lastTruncated = read.truncated;
      state.totalChars += read.text.length;
      const busy = token(state.region, 'aria-busy', ['true', 'false']);
      state.observations.push({
        index: state.observations.length + 1,
        elapsedMs: Math.round(performance.now() - startedAtPerf),
        text: read.text,
        empty: read.empty,
        truncated: read.truncated,
        mutationRecords: relevant.length,
        ...(busy ? { ariaBusy: busy === 'true' } : {})
      });
      if (state.observations.length >= limits.maxObservations) stop(state, 'observation-limit');
    });
    state.observer.observe(region, { childList: true, subtree: true, characterData: true });
    state.timer = setTimeout(() => stop(state, 'expired'), limits.maxDurationMs);
    globalThis[key] = state;
    return snapshot(state);
  })()`
}

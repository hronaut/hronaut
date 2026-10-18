import { javascriptLiteral } from '../../../shared/javascript-literal.js'

/**
 * Takes an agent's cursor off the page and resolves once the page has painted without it, or at once
 * when there is none. Only Hronaut's own hosts, which sit directly under the root element, are removed.
 */
export function dismissAgentPointerScript(): string {
  return `(async () => {
    const state = globalThis.__hronautAgentCursor;
    if (state && Array.isArray(state.timers)) for (const timer of state.timers) clearTimeout(timer);
    globalThis.__hronautAgentCursor = undefined;
    const hosts = document.documentElement.querySelectorAll(':scope > [data-hronaut-agent-pointer]');
    if (!hosts.length) return false;
    hosts.forEach((node) => node.remove());
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    return true;
  })()`
}

/** Who an agent's cursor belongs to: its client's name (may be empty), and the avatar's fill and ink colors. */
export interface AgentPointerIdentity {
  name: string
  fill: string
  ink: string
}

/** How long an agent's cursor stays after it arrives, and how long it takes to fade out. */
export const AGENT_POINTER_IDLE_MS = 2_000
export const AGENT_POINTER_FADE_MS = 320

/**
 * Draws an agent's cursor on the page, in its own isolated world: it glides from where it is to the point
 * in 600 to 900 ms, carries the agent's name in its avatar's color, and fades after two idle seconds. A click
 * or the start of a drag leaves a ripple at the point at once, since the input itself does not wait for the
 * glide; the end of a drag waits for the cursor to reach the drag's start, and holds it pressed until it
 * arrives.
 */
export function agentPointerScript(
  point: { x: number; y: number },
  effect: 'move' | 'click' | 'drag-start' | 'drag-end',
  origin?: { x: number; y: number },
  agent?: AgentPointerIdentity
): string {
  return `(() => {
    const point = ${JSON.stringify(point)};
    const effect = ${JSON.stringify(effect)};
    const origin = ${JSON.stringify(origin ?? null)};
    const agent = ${javascriptLiteral(agent ?? null)};
    const IDLE_MS = ${AGENT_POINTER_IDLE_MS};
    const FADE_MS = ${AGENT_POINTER_FADE_MS};
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    if (origin && (!Number.isFinite(origin.x) || !Number.isFinite(origin.y))) return false;
    const color = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
    const colored = Boolean(agent) && color(agent.fill) && color(agent.ink);
    const name = colored && typeof agent.name === 'string' && agent.name.length <= 128 ? agent.name : '';
    const media = (query) => typeof matchMedia === 'function' && matchMedia(query).matches;
    const reduced = media('(prefers-reduced-motion: reduce)');
    const forced = media('(forced-colors: active)');
    const now = () => (typeof performance === 'object' ? performance.now() : Date.now());
    // The host shares the page's DOM, so its own styles outrank the page's, even !important ones.
    const pin = (element, styles) => {
      for (const [property, value] of Object.entries(styles)) element.style.setProperty(property, value, 'important');
    };

    // One cursor per document, kept in this isolated world, so the next step glides from where it is.
    let state = globalThis.__hronautAgentCursor;
    if (!state || !(state.host instanceof HTMLElement) || !state.host.isConnected
      || state.host.getAttribute('data-hronaut-agent-pointer') !== 'v2' || !(state.cursor instanceof HTMLElement)) state = undefined;
    let fresh = false;
    if (!state) {
      document.documentElement.querySelectorAll(':scope > [data-hronaut-agent-pointer]').forEach((node) => node.remove());
      const host = document.createElement('div');
      host.setAttribute('data-hronaut-agent-pointer', 'v2');
      host.setAttribute('aria-hidden', 'true');
      pin(host, {
        all: 'initial',
        display: 'block',
        position: 'fixed',
        left: '0',
        top: '0',
        width: '0',
        height: '0',
        transform: 'none',
        'z-index': '2147483647',
        'pointer-events': 'none',
        opacity: '1',
        transition: 'opacity ' + FADE_MS + 'ms ease',
        contain: 'style',
        'forced-color-adjust': 'none'
      });
      const root = host.attachShadow({ mode: 'closed' });
      // The cursor moves inside the host, so ripples can stay where the input happened.
      const cursor = document.createElement('div');
      cursor.setAttribute('data-cursor', '');
      Object.assign(cursor.style, { position: 'absolute', left: '0', top: '0' });
      const pointer = document.createElement('div');
      pointer.setAttribute('data-arrow', '');
      Object.assign(pointer.style, {
        position: 'absolute',
        left: '-2px',
        top: '-2px',
        width: '18px',
        height: '24px',
        clipPath: 'polygon(0 0, 100% 68%, 57% 72%, 38% 100%)',
        filter: 'drop-shadow(0 0 1px white) drop-shadow(0 2px 3px rgba(0,0,0,.45))',
        transformOrigin: '2px 2px',
        transition: reduced ? 'none' : 'transform 120ms ease-out'
      });
      const tag = document.createElement('span');
      tag.setAttribute('dir', 'auto');
      Object.assign(tag.style, {
        position: 'absolute',
        left: '14px',
        top: '20px',
        maxWidth: '180px',
        padding: '0 8px',
        borderRadius: '999px',
        font: '500 12px/18px system-ui, sans-serif',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        boxShadow: '0 1px 3px rgba(0,0,0,.3)',
        boxSizing: 'border-box'
      });
      cursor.append(pointer, tag);
      root.append(cursor);
      const start = effect === 'drag-end' && origin ? origin : point;
      cursor.style.transform = 'translate3d(' + start.x + 'px,' + start.y + 'px,0)';
      document.documentElement.append(host);
      state = { host, root, cursor, pointer, tag, x: start.x, y: start.y, arriveAt: 0, pressed: false, timers: [] };
      globalThis.__hronautAgentCursor = state;
      fresh = true;
    }
    const { host, root, cursor, pointer, tag } = state;
    for (const timer of state.timers) clearTimeout(timer);
    state.timers = [];
    const later = (callback, delay) => { state.timers.push(setTimeout(callback, delay)); };

    pointer.style.background = forced ? 'CanvasText' : colored ? agent.fill : '#6757e8';
    tag.textContent = name;
    tag.style.display = name ? 'block' : 'none';
    Object.assign(tag.style, forced
      ? { background: 'Canvas', color: 'CanvasText', border: '1px solid CanvasText' }
      : { background: colored ? agent.fill : '#6757e8', color: colored ? agent.ink : '#ffffff', border: '0' });
    pin(host, { opacity: '1' });

    // A ripple marks where the input happened, when it happened, wherever the cursor is in its glide.
    const ripple = () => {
      const ripples = root.querySelectorAll('[data-ripple]');
      if (ripples.length >= 3) ripples[0].remove();
      const pulse = document.createElement('div');
      pulse.setAttribute('data-ripple', '');
      Object.assign(pulse.style, {
        position: 'absolute',
        left: (point.x - 12) + 'px',
        top: (point.y - 12) + 'px',
        width: '24px',
        height: '24px',
        border: '2px solid ' + (forced ? 'Highlight' : colored ? agent.fill : '#8d80ff'),
        borderRadius: '999px',
        boxSizing: 'border-box',
        opacity: '0'
      });
      root.append(pulse);
      const frames = reduced
        ? [{ opacity: 0.9 }, { opacity: 0 }]
        : [{ opacity: 0.9, transform: 'scale(.35)' }, { opacity: 0, transform: 'scale(1.6)' }];
      if (typeof pulse.animate === 'function') {
        const animation = pulse.animate(frames, { duration: 600, easing: 'ease-out' });
        animation.finished.then(() => pulse.remove(), () => pulse.remove());
      } else {
        setTimeout(() => pulse.remove(), 600);
      }
    };
    if (effect === 'click' || effect === 'drag-start') ripple();

    const glide = () => {
      // Measure from where the cursor is on screen, which is not its last target while it is still gliding.
      let fromX = state.x;
      let fromY = state.y;
      if (now() < state.arriveAt && typeof DOMMatrixReadOnly === 'function') {
        try {
          const matrix = new DOMMatrixReadOnly(getComputedStyle(cursor).transform);
          fromX = matrix.m41;
          fromY = matrix.m42;
        } catch {}
      }
      const distance = Math.hypot(point.x - fromX, point.y - fromY);
      const duration = reduced || distance < 1 ? 0 : Math.round(Math.min(900, Math.max(600, 600 + distance * 0.25)));
      if (fresh && duration) cursor.getBoundingClientRect();
      cursor.style.transition = duration ? 'transform ' + duration + 'ms cubic-bezier(.16,1,.3,1)' : 'none';
      cursor.style.transform = 'translate3d(' + point.x + 'px,' + point.y + 'px,0)';
      state.x = point.x;
      state.y = point.y;
      state.arriveAt = now() + duration;
      const pressed = effect === 'drag-start' || effect === 'drag-end';
      state.pressed = effect === 'drag-start';
      pointer.style.transform = pressed ? 'scale(.84)' : 'scale(1)';
      // A drag lets go once it reaches its end.
      if (effect === 'drag-end') later(() => { pointer.style.transform = 'scale(1)'; }, duration);
      later(() => { pin(host, { opacity: '0' }); }, duration + IDLE_MS);
      later(() => {
        host.remove();
        if (globalThis.__hronautAgentCursor === state) globalThis.__hronautAgentCursor = undefined;
      }, duration + IDLE_MS + FADE_MS);
    };
    // The end of a drag starts from the drag's start, so it waits for the cursor to get there.
    const wait = effect === 'drag-end' && state.pressed ? Math.max(0, Math.ceil(state.arriveAt - now())) : 0;
    if (wait) {
      pointer.style.transform = 'scale(.84)';
      later(glide, wait);
    } else {
      glide();
    }
    return true;
  })()`
}

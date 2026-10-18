/**
 * Page scripts for a file drop. They run in the file drop's own isolated
 * world, which shares the page's DOM but not its scripts, so the page cannot
 * read or replace the state they keep, one record per drop keyed by its
 * token. They never read the dropped files.
 */

/** Why the drop target cannot take a drop: each maps to one message in file-drop.ts. */
export type FileDropTargetProblem = 'invalid-selector' | 'not-found' | 'ambiguous' | 'frame' | 'scaled-viewport' | 'hidden' | 'outside' | 'covered' | 'replaced'

/** The point to drop on, or why there is none. */
export type FileDropLocation = { x: number; y: number } | { problem: FileDropTargetProblem; count?: number }

/** What the page's trusted drag events showed. */
export interface FileDropObservation {
  /** The recording for this drop is still on the page: it was not navigated or reloaded. */
  current: boolean
  /** In the dragover phase: the drag update reached the page as a dragover, not as a dragenter onto a new element. */
  dragOverArrived: boolean
  /** The last dragover reached the page and one of its handlers called preventDefault(), accepting the files. */
  dragOverAccepted: boolean
  /** A drop event reached the page. */
  dropSeen: boolean
  /** One of the page's drop handlers called preventDefault(), as drop zones do when they take the files. */
  dropHandled: boolean
  /** In the drop phase: a dragleave and no drop reached the page, so Chromium ended the drag without dropping. */
  leftWithoutDrop: boolean
}

/**
 * Resolves the one element the ref or selector names in the top-level
 * document, scrolls it to the middle of the viewport and returns its center,
 * after checking that nothing covers it there and that it is not a frame.
 * With install, it starts recording the page's trusted drag events for this
 * drop under the token. Without it, it checks that the element is still the
 * one recorded under the token and restarts the record, so events from
 * another drag before this one's turn do not count.
 */
export function fileDropLocateScript(target: { ref?: string; selector?: string }, token: string, install: boolean): string {
  return `(() => {
    const target = ${JSON.stringify(target)};
    const token = ${JSON.stringify(token)};
    const install = ${JSON.stringify(install)};
    let matches;
    try {
      matches = document.querySelectorAll(target.ref ? '[data-hronaut-ref="' + CSS.escape(target.ref) + '"]' : target.selector);
    } catch {
      return { problem: 'invalid-selector' };
    }
    if (matches.length === 0) return { problem: 'not-found' };
    if (matches.length > 1) return { problem: 'ambiguous', count: matches.length };
    const element = matches[0];
    const drops = globalThis.__hronautFileDrops || (globalThis.__hronautFileDrops = new Map());
    const recorded = drops.get(token);
    if (!install && (!recorded || recorded.element !== element)) return { problem: 'replaced' };
    const isFrame = (node) => /^(IFRAME|FRAME|OBJECT|EMBED|FENCEDFRAME|PORTAL)$/.test(node.tagName);
    if (isFrame(element)) return { problem: 'frame' };
    // Drag points match the page's coordinates only at a visual viewport scale of 1; the off-page point needs it too.
    if (window.visualViewport && Math.abs(window.visualViewport.scale - 1) > 0.001) return { problem: 'scaled-viewport' };
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || rect.width <= 0 || rect.height <= 0) {
      return { problem: 'hidden' };
    }
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return { problem: 'outside' };
    const hit = document.elementFromPoint(x, y);
    if (!hit || (hit !== element && !element.contains(hit))) return { problem: 'covered' };
    if (isFrame(hit)) return { problem: 'frame' };
    if (!install) Object.assign(recorded, { enters: 0, overs: 0, leaves: 0, seenEnters: 0, seenOvers: 0, dragOver: null, drop: null });
    if (install) {
      const state = { element, enters: 0, overs: 0, leaves: 0, seenEnters: 0, seenOvers: 0, dragOver: null, drop: null, wake: null };
      const record = (update) => (event) => {
        if (!event.isTrusted) return;
        update(event);
        if (state.wake) state.wake();
      };
      const onDragEnter = record(() => { state.enters += 1; });
      const onDragOver = record((event) => { state.overs += 1; state.dragOver = event; });
      const onDrop = record((event) => { state.drop = event; });
      const onDragLeave = record(() => { state.leaves += 1; });
      state.dispose = () => {
        removeEventListener('dragenter', onDragEnter, true);
        removeEventListener('dragover', onDragOver, true);
        removeEventListener('drop', onDrop, true);
        removeEventListener('dragleave', onDragLeave, true);
        drops.delete(token);
      };
      // Capture listeners on the window see the events before the page's own
      // handlers; the recorded event shows afterwards whether one of them
      // called preventDefault().
      addEventListener('dragenter', onDragEnter, true);
      addEventListener('dragover', onDragOver, true);
      addEventListener('drop', onDrop, true);
      addEventListener('dragleave', onDragLeave, true);
      drops.set(token, state);
    }
    return { x, y };
  })()`
}

/**
 * Reports what the page's drag events under the token showed once the event
 * the phase waits for arrived, or after two seconds. Chromium delivers drag
 * events to the page on its own schedule, and gives a drag update that moves
 * onto another element (such as an overlay the page showed on dragenter) to
 * the page as a dragenter and dragleave with no dragover. So the enter phase
 * waits for the dragenter or a dragover, the dragover phase for a dragover or
 * a dragenter, and the drop phase for a drop or the dragleave that ends a drag
 * Chromium did not drop; each phase takes the events it waited for, so the
 * next phase waits only for new ones. The answer waits until the page's own
 * handlers for the event have run, so it can tell whether they accepted it.
 */
export function fileDropObserveScript(token: string, phase: 'enter' | 'over' | 'drop'): string {
  return `(async () => {
    const token = ${JSON.stringify(token)};
    const phase = ${JSON.stringify(phase)};
    const state = globalThis.__hronautFileDrops && globalThis.__hronautFileDrops.get(token);
    if (!state) return { current: false, dragOverArrived: false, dragOverAccepted: false, dropSeen: false, dropHandled: false, leftWithoutDrop: false };
    const arrived = () => phase === 'drop'
      ? Boolean(state.drop) || state.leaves > 0
      : state.enters > state.seenEnters || state.overs > state.seenOvers;
    // A message task runs after the event's dispatch, so after the page's handlers.
    const afterDispatch = () => new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(null);
    });
    await new Promise((resolve) => {
      if (arrived()) return resolve();
      const timer = setTimeout(() => { state.wake = null; resolve(); }, 2000);
      state.wake = () => {
        if (!arrived()) return;
        clearTimeout(timer);
        state.wake = null;
        afterDispatch().then(resolve);
      };
    });
    const observation = {
      current: true,
      dragOverArrived: phase === 'over' && state.overs > state.seenOvers,
      dragOverAccepted: Boolean(state.dragOver && state.dragOver.defaultPrevented),
      dropSeen: Boolean(state.drop),
      dropHandled: Boolean(state.drop && state.drop.defaultPrevented),
      leftWithoutDrop: phase === 'drop' && !state.drop && state.leaves > 0
    };
    state.seenEnters = state.enters;
    state.seenOvers = state.overs;
    // Leaving an element for an overlay happens before the drop; only a later dragleave ends the drag.
    if (phase === 'over') state.leaves = 0;
    return observation;
  })()`
}

/** Stops recording the page's drag events under the token. */
export function fileDropDisposeScript(token: string): string {
  return `(() => {
    const state = globalThis.__hronautFileDrops && globalThis.__hronautFileDrops.get(${JSON.stringify(token)});
    if (state) state.dispose();
    return true;
  })()`
}

/**
 * The autosave state machine, with no React in it.
 *
 * It lives outside a component so it can be tested without a browser, and — the
 * reason it was pulled out — so that "is anybody listening" is a subscription
 * rather than a boolean somebody has to keep in step.
 *
 * ── The bug this shape prevents ──
 *
 * The previous version held `const alive = useRef(true)` and cleared it in an
 * effect cleanup:
 *
 *     useEffect(() => () => { alive.current = false; }, []);
 *
 * React StrictMode mounts every component twice in development — effect,
 * cleanup, effect — and nothing ever set that flag back to `true`. Every save
 * still ran, but every state update around it was skipped, so the indicator sat
 * on "Unsaved changes" forever while the note was in fact saving perfectly.
 *
 * A listener cannot drift the same way: attaching is what the effect *body*
 * does, so a second mount re-attaches it. There is no state to restore.
 */

/** What to show a person for each state. */
export const saveLabel = (state) => ({
  idle: '',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Could not save',
}[state] ?? '');

export function createSaver({ save, delay = 900, retryDelay = 400 }) {
  let pending = null;
  let running = false;
  let timer = null;
  let listener = null;
  let state = 'idle';
  let error = null;

  const emit = (nextState, nextError = null) => {
    state = nextState;
    error = nextError;
    listener?.({ state, error });
  };

  async function flush() {
    // Never two in flight. Out-of-order landings let an older save win, which
    // silently reverts whatever was typed in between.
    if (running || pending === null) return;

    const draft = pending;
    pending = null;
    running = true;
    emit('saving');

    try {
      await save(draft);
      // Something arrived while we were saving — say so rather than reporting
      // "saved" over the top of an edit that has not been.
      emit(pending === null ? 'saved' : 'dirty');
    } catch (saveError) {
      // Put it back. The draft is the only copy there is.
      if (pending === null) pending = draft;
      emit('error', saveError?.message ?? 'Could not save');
    } finally {
      running = false;
      if (pending !== null) {
        clearTimeout(timer);
        timer = setTimeout(flush, retryDelay);
      }
    }
  }

  return {
    /** An edit happened. Coalesces — only the newest draft is ever sent. */
    queue(draft) {
      pending = draft;
      emit('dirty');
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },

    /** Save now: leaving the page, closing the panel, pressing Done. */
    flushNow() {
      clearTimeout(timer);
      return flush();
    },

    /** Returns an unsubscribe. Attaching is what a mount does. */
    listen(fn) {
      listener = fn;
      // Hand over the current state immediately, so a remount does not show
      // "idle" for a note that is midway through saving.
      fn({ state, error });
      return () => { if (listener === fn) listener = null; };
    },

    snapshot: () => ({ state, error }),
    hasPending: () => pending !== null,
    isRunning: () => running,

    /** Drop a scheduled save without sending it. For teardown only. */
    cancel() { clearTimeout(timer); },
  };
}

export default createSaver;

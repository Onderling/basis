// canopy-chat v2 — shared composer affordances: slash-command auto-suggest + bash-style input history.
//
// Lifted verbatim (semantics-preserving) from the CLASSIC shell's composer (web/main.js, #199 +
// the v0.7 history catch-up) so the v2 kring composer can reach feature parity on BOTH platforms
// from ONE source. The classic shell baked these into DOM-coupled handlers; here they're pure,
// platform-neutral logic — web renders a <ul> dropdown, mobile renders an RN list, both drive off
// the same functions. This is the canopy-chat "write-once, both shells inject only UI" principle
// (see web-mobile-consolidation-plan.md; [[canopy-chat-unifier-principle]], [[platform-parity]]).

/**
 * Build the slash-command pool from a merged catalog: every op that declares a `surfaces.slash.command`,
 * as `{ command, hint, opId }`, sorted by command. The `hint` is the op's `surfaces.chat.hint` (falls
 * back to the op id). Mirrors classic `commandPool()` (main.js).
 *
 * @param {{opsById?: Map<string, any>}} catalog  the merged + filtered catalog (mergeManifests → filterCatalog)
 * @returns {Array<{command: string, hint: string, opId: string}>}
 */
export function buildCommandPool(catalog) {
  const ops = catalog && catalog.opsById;
  if (!ops || typeof ops.values !== 'function') return [];
  const out = [];
  for (const entry of ops.values()) {
    const op = (entry && entry.op) ? entry.op : entry;
    const slash = op && op.surfaces && op.surfaces.slash && op.surfaces.slash.command;
    if (typeof slash !== 'string' || !slash) continue;
    out.push({
      command: slash,
      hint: (op.surfaces.chat && op.surfaces.chat.hint) || op.id || '',
      opId: op.id || '',
    });
  }
  return out.sort((a, b) => a.command.localeCompare(b.command));
}

/**
 * Given the composer's current text, return the ranked slash-command matches (≤ `limit`). Suggest ONLY
 * while the user is typing the command WORD: the input starts with '/' and has no space yet (once they
 * type a space they're into args, so the list closes). Prefix match, case-insensitive. Mirrors classic
 * `refreshSuggest()` (main.js).
 *
 * @param {object} catalog
 * @param {string} inputValue
 * @param {{limit?: number}} [opts]
 * @returns {Array<{command: string, hint: string, opId: string}>}
 */
export function suggestCommands(catalog, inputValue, { limit = 12 } = {}) {
  const v = typeof inputValue === 'string' ? inputValue : '';
  if (!v.startsWith('/') || v.includes(' ')) return [];
  const needle = v.toLowerCase();
  return buildCommandPool(catalog)
    .filter((m) => m.command.toLowerCase().startsWith(needle))
    .slice(0, limit);
}

/**
 * Bash-style in-memory command history with draft preservation. ArrowUp cycles back through prior sends;
 * ArrowDown cycles forward; arrowing past the newest entry restores the draft the user was typing when
 * they started cycling. De-dups consecutive identical entries and caps the buffer. Stateful — the host
 * creates ONE instance per composer and keeps it across re-renders (the classic shell kept it at module
 * scope, web/main.js `inputHistory`/`inputHistoryIdx`/`inputPendingDraft`).
 *
 * @param {{cap?: number}} [opts]
 * @returns {{push(text:string):void, prev(draft?:string):(string|null), next():(string|null), reset():void, readonly size:number}}
 */
export function createInputHistory({ cap = 200 } = {}) {
  const items = [];
  let idx = -1;            // -1 = live (not navigating); else an index into `items`
  let pendingDraft = '';

  return {
    /** Record a sent message (call on submit). Resets navigation. */
    push(text) {
      const t = typeof text === 'string' ? text : '';
      if (!t) return;
      if (items[items.length - 1] !== t) items.push(t);   // de-dup consecutive (bash)
      while (items.length > cap) items.shift();
      idx = -1;
      pendingDraft = '';
    },
    /** ArrowUp — the previous entry, or null when there's no history. On the FIRST step, `draft` (the
     *  current unsent text) is saved so `next()` can restore it after passing the newest entry. */
    prev(draft) {
      if (items.length === 0) return null;
      if (idx === -1) {
        pendingDraft = typeof draft === 'string' ? draft : '';
        idx = items.length - 1;
      } else if (idx > 0) {
        idx -= 1;
      }
      return items[idx];
    },
    /** ArrowDown — the next entry, or the restored draft once past the newest; null if not navigating. */
    next() {
      if (idx === -1) return null;
      if (idx < items.length - 1) {
        idx += 1;
        return items[idx];
      }
      idx = -1;
      return pendingDraft;
    },
    /** Abandon navigation (e.g. on manual edit / blur) without recording anything. */
    reset() { idx = -1; pendingDraft = ''; },
    get size() { return items.length; },
  };
}

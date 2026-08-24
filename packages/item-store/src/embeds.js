/**
 * embeds — cross-app reference traversal.
 *
 * Every item type may carry an `embeds: [{type, ref}, ...]` field —
 * standardised by `@onderling/item-types`. Refs are URIs (pseudo-pod
 * or pod-attached). Apps walk the graph at render time to surface
 * the embedded chips inline.
 *
 * `treeOf(rootId, opts)` walks BOTH `dependencies` (subtask graph)
 * AND `embeds` (cross-type refs). Refs outside the local store are
 * resolved via the caller-supplied `resolveExternalRef` callback;
 * permission failures or missing refs surface as placeholder nodes
 * rather than throwing.
 *
 * Standardisation Phase 52.6.1.
 */

/**
 * @typedef {object} TreeNode
 * @property {string} id                 — local item id, or `null` for placeholders
 * @property {string} [type]
 * @property {object} [item]             — full item record (when resolved)
 * @property {string} [ref]              — original URI (only on embed nodes)
 * @property {'local'|'external'|'placeholder'} source
 * @property {string} [reason]           — populated for placeholders (e.g. 'NOT_FOUND', 'PERMISSION_DENIED')
 * @property {TreeNode[]} subtasks       — from `dependencies`
 * @property {TreeNode[]} embeds         — from `embeds[]`
 */

/**
 * Walk the dependencies + embeds graph rooted at `rootId`.
 *
 * @param {object} args
 * @param {string} args.rootId
 * @param {(id: string) => Promise<object|null>} args.getItem
 *   Read an item by id from the local store. Substrate normally
 *   passes a closure over its DataSource.
 * @param {(ref: string) => Promise<{item?: object} | null>} [args.resolveExternalRef]
 *   Optional: fetch an item by external URI ref. May throw on
 *   permission failure — the walk yields a placeholder.
 * @param {number} [args.maxDepth=8]  — guards against accidental cycles
 *
 * @returns {Promise<TreeNode>}
 */
export async function treeOf({
  rootId,
  getItem,
  resolveExternalRef,
  maxDepth = 8,
} = {}) {
  if (typeof rootId !== 'string' || rootId.length === 0) {
    throw Object.assign(
      new Error('treeOf: rootId is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (typeof getItem !== 'function') {
    throw Object.assign(
      new Error('treeOf: getItem is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  const seenLocal    = new Set();
  const seenExternal = new Set();

  async function walkLocal(id, depth) {
    if (seenLocal.has(id) || depth > maxDepth) {
      return _placeholder({ id, source: 'placeholder', reason: 'CYCLE_OR_DEPTH' });
    }
    seenLocal.add(id);
    const item = await getItem(id);
    if (!item) {
      return _placeholder({ id, source: 'placeholder', reason: 'NOT_FOUND' });
    }
    const subtasks = [];
    for (const depId of item.dependencies ?? []) {
      subtasks.push(await walkLocal(depId, depth + 1));
    }
    const embeds = [];
    for (const e of item.embeds ?? []) {
      embeds.push(await walkEmbed(e, depth + 1));
    }
    return {
      id,
      type: item.type,
      item,
      source: 'local',
      subtasks,
      embeds,
    };
  }

  async function walkEmbed(embed, depth) {
    if (!embed || typeof embed !== 'object') {
      return _placeholder({ id: null, source: 'placeholder', reason: 'BAD_EMBED' });
    }
    const { type, ref } = embed;
    if (typeof ref !== 'string' || ref.length === 0) {
      return _placeholder({ id: null, type, source: 'placeholder', reason: 'BAD_EMBED' });
    }
    if (seenExternal.has(ref)) {
      return _placeholder({ id: null, type, ref, source: 'placeholder', reason: 'CYCLE_OR_DEPTH' });
    }
    if (depth > maxDepth) {
      return _placeholder({ id: null, type, ref, source: 'placeholder', reason: 'CYCLE_OR_DEPTH' });
    }
    seenExternal.add(ref);
    if (typeof resolveExternalRef !== 'function') {
      return _placeholder({ id: null, type, ref, source: 'placeholder', reason: 'NO_RESOLVER' });
    }
    let resolved;
    try {
      resolved = await resolveExternalRef(ref);
    } catch (err) {
      return _placeholder({
        id:     null,
        type,
        ref,
        source: 'placeholder',
        reason: err?.code ?? 'RESOLVE_FAILED',
      });
    }
    if (!resolved || !resolved.item) {
      return _placeholder({ id: null, type, ref, source: 'placeholder', reason: 'NOT_FOUND' });
    }
    return {
      id:     resolved.item.id ?? null,
      type:   resolved.item.type ?? type,
      item:   resolved.item,
      ref,
      source: 'external',
      subtasks: [],
      embeds:   [],
    };
  }

  return walkLocal(rootId, 0);
}

function _placeholder({ id, type, ref, source, reason }) {
  return {
    id,
    ...(type ? { type } : {}),
    ...(ref  ? { ref }  : {}),
    source,
    reason,
    subtasks: [],
    embeds:   [],
  };
}

/**
 * createCrossPodRefResolver — a ready-made
 * `resolveExternalRef` for {@link treeOf}, dispatching the three
 * canonical `embeds` ref shapes (`conventions/cross-pod-refs.md`):
 *
 *   - `urn:dec:item:<ulid>`    → local `getItem(ulid)`
 *   - `pseudo-pod://<dev>/…`   → injected `pseudoPodRead(ref)`
 *   - `http(s)://…`            → injected `podFetch(ref)` (GET)
 *
 * This is the decentralised-circle read path: a member's item embeds
 * a ref into ANOTHER member's pod; the walker resolves it through
 * here. Pure — every I/O is injected. A permission failure throws
 * `{code:'PERMISSION_DENIED'}` so the walker yields a precise
 * placeholder (the cross-pod-refs.md three-tier render fallback);
 * a missing ref → `null` → `NOT_FOUND` placeholder.
 *
 * @param {object} deps
 * @param {(id:string)=>Promise<object|null>} [deps.getItem]
 * @param {(ref:string)=>Promise<{bytes:*}|null>} [deps.pseudoPodRead]
 * @param {(ref:string)=>Promise<{ok?:boolean,status?:number,text?:Function}>} [deps.podFetch]
 * @returns {(ref:string)=>Promise<{item:object}|null>}
 */
export function createCrossPodRefResolver({ getItem, pseudoPodRead, podFetch } = {}) {
  return async function resolveExternalRef(ref) {
    if (typeof ref !== 'string' || ref.length === 0) return null;

    if (ref.startsWith('urn:dec:item:')) {
      if (typeof getItem !== 'function') return null;
      const item = await getItem(ref.slice('urn:dec:item:'.length));
      return item ? { item } : null;
    }

    if (ref.startsWith('pseudo-pod://')) {
      if (typeof pseudoPodRead !== 'function') return null;
      const rec  = await pseudoPodRead(ref);
      const item = _parseItem(rec && rec.bytes);
      return item ? { item } : null;
    }

    if (ref.startsWith('https://') || ref.startsWith('http://')) {
      if (typeof podFetch !== 'function') return null;
      const res = await podFetch(ref);
      if (!res) return null;
      if (res.ok === false) {
        if (res.status === 401 || res.status === 403) {
          throw Object.assign(new Error(`cross-pod ref forbidden: ${ref}`),
            { code: 'PERMISSION_DENIED', status: res.status });
        }
        if (res.status === 404) return null;
        throw Object.assign(new Error(`cross-pod ref failed: ${res.status}`),
          { code: 'RESOLVE_FAILED', status: res.status });
      }
      const body = typeof res.text === 'function' ? await res.text() : null;
      const item = _parseItem(body);
      if (!item) {
        throw Object.assign(new Error(`cross-pod ref not JSON: ${ref}`),
          { code: 'PARSE_ERROR' });
      }
      return { item };
    }

    return null; // unknown scheme — NOT_FOUND placeholder
  };
}

function _parseItem(bytes) {
  if (bytes == null) return null;
  let text;
  if (typeof bytes === 'string') {
    text = bytes;
  } else if (typeof bytes === 'object') {
    try { text = new TextDecoder().decode(bytes); }
    catch {
      try { text = Buffer.from(bytes).toString('utf8'); }
      catch { return null; }
    }
  } else {
    return null;
  }
  try {
    const o = JSON.parse(text);
    return (o && typeof o === 'object') ? o : null;
  } catch {
    return null;
  }
}

/**
 * The whole `getItemTree` op body, once — walk an item's embeds/deps tree and materialise the
 * cross-pod refs in it.
 *
 * This existed TWICE, in stoop's skills and in tasks' workspace, the second copied from the first
 * (its comment said so) along with a test described as an "analog" of the other. The two were
 * identical but for which store they read, which is exactly the difference a parameter is for. Two
 * copies of a decentralised READ path is a bad thing to let drift: it is the executable half of the
 * `embeds: [{type, ref}]` convention, and a divergence between them is a divergence in what a
 * cross-pod reference means.
 *
 * Both embeds shapes are bridged here — top-level (the canonical slot) and `source.embeds`, where
 * items originating in a noticeboard put them — so neither caller has to know about the other's.
 *
 * @param {object} a
 * @param {string} a.itemId                  the root
 * @param {(id: string) => Promise<object|null>} a.getById   the caller's store read
 * @param {(ref: string) => Promise<*>} [a.pseudoPodRead]    local pod-cache read, when wired
 * @param {(url: string) => Promise<Response>} [a.podFetch]  cross-pod fetch (defaults to public GET)
 * @returns {Promise<{tree: object}|{error: string}>}
 */
export async function itemTreeFor({ itemId, getById, pseudoPodRead, podFetch } = {}) {
  if (typeof itemId !== 'string' || !itemId) return { error: 'itemId required' };
  if (typeof getById !== 'function') return { error: 'store unavailable' };

  const getItem = async (id) => {
    const it = await Promise.resolve(getById(id)).catch(() => null);
    if (!it) return null;
    return {
      ...it,
      embeds:       it.embeds       ?? it.source?.embeds       ?? [],
      dependencies: it.dependencies ?? it.source?.dependencies ?? [],
    };
  };

  const resolveExternalRef = createCrossPodRefResolver({
    getItem,
    pseudoPodRead: typeof pseudoPodRead === 'function' ? pseudoPodRead : undefined,
    // V1 public fetch — an ACP-protected ref answers 401/403 and becomes the PERMISSION_DENIED
    // placeholder the three-tier render expects, rather than an error that loses the whole tree.
    podFetch: podFetch ?? ((url) => fetch(url, {
      headers: { Accept: 'application/json, text/turtle;q=0.5' },
    })),
  });

  try {
    return { tree: await treeOf({ rootId: itemId, getItem, resolveExternalRef }) };
  } catch (err) {
    return { error: err?.message ?? String(err) };
  }
}

/**
 * MemberMapCache — auto-persist a `MemberMap` through any
 * `core.DataSource` (typically a `CachingDataSource` from
 * `@onderling/local-store`).
 *
 * **2026-05-08:** lifted from `apps/pinboard/src/lib/MemberMapCache.js`
 * (Tasks V1 = rule-of-two consumer per
 * `Project Files/Pinboard/migration-tasks-v1-lifts-2026-05-08.md`).
 * Pinboard's `lib/MemberMapCache.js` is now a re-export shim.
 *
 * Originally Pinboard V1 Phase 11 (2026-05-06): profile + skills
 * auto-persist (functional design § A7).  No "save" button — every
 * `addMember` / `removeMember` event flushes through to the cache,
 * which itself either stays local-only or write-throughs to the
 * pod when one is attached.
 *
 * Storage layout (under the supplied `rootContainer`):
 *
 *   members/<webid-encoded>.json            — one file per member
 *
 * The webid is URI-encoded so the path is filesystem-safe; on the
 * pod side it's URL-quoted naturally.
 *
 * Boot path:
 *
 *   const map = await MemberMapCache.load({ dataSource, rootContainer });
 *   // ... use `map` like any MemberMap; mutations auto-persist.
 *   const detach = MemberMapCache.attach({ map, dataSource, rootContainer });
 *   // detach() to stop persisting (e.g. on app shutdown).
 *
 * Or, for the common "load + attach" pattern:
 *
 *   const { map, detach } = await MemberMapCache.bootstrap({
 *     dataSource, rootContainer,
 *   });
 */

import { MemberMap } from './MemberMap.js';

const MEMBERS_PREFIX = 'members/';

function pathFor(webid) {
  return MEMBERS_PREFIX + encodeURIComponent(webid);
}

/**
 * Read all member entries under `rootContainer/members/` and rebuild
 * a fresh `MemberMap`.  Returns an empty MemberMap when the path is
 * empty (cold boot).
 *
 * @param {object} args
 * @param {import('@onderling/core').DataSource} args.dataSource
 * @param {string} [args.rootContainer='']    prefix; trailing '/' optional
 */
async function load({ dataSource, rootContainer = '' } = {}) {
  if (!dataSource || typeof dataSource.list !== 'function') {
    throw new TypeError('MemberMapCache.load: dataSource (DataSource) required');
  }
  const root = rootContainer.endsWith('/') ? rootContainer : (rootContainer ? rootContainer + '/' : '');
  const prefix = root + MEMBERS_PREFIX;
  const paths = await dataSource.list(prefix);
  const initial = [];
  for (const p of paths) {
    const raw = await dataSource.read(p);
    if (raw == null) continue;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === 'object' && parsed.webid) initial.push(parsed);
    } catch { /* skip corrupt entries */ }
  }
  return new MemberMap({ initial });
}

/**
 * Wire a MemberMap so every mutation flushes through to the
 * dataSource.  Returns a detach function that removes the listeners.
 *
 * @param {object} args
 * @param {MemberMap} args.map
 * @param {import('@onderling/core').DataSource} args.dataSource
 * @param {string} [args.rootContainer='']
 */
function attach({ map, dataSource, rootContainer = '' } = {}) {
  if (!map || typeof map.on !== 'function') {
    throw new TypeError('MemberMapCache.attach: map (MemberMap) required');
  }
  if (!dataSource || typeof dataSource.write !== 'function') {
    throw new TypeError('MemberMapCache.attach: dataSource (DataSource) required');
  }
  const root = rootContainer.endsWith('/') ? rootContainer : (rootContainer ? rootContainer + '/' : '');

  const onAddOrUpdate = (member) => {
    if (!member?.webid) return;
    void dataSource.write(root + pathFor(member.webid), JSON.stringify(member))
      .catch(() => { /* persistence is best-effort; dataSource emits its own errors */ });
  };
  const onRemoved = ({ webid }) => {
    if (!webid) return;
    void dataSource.delete(root + pathFor(webid))
      .catch(() => {});
  };

  map.on('member-added',   onAddOrUpdate);
  map.on('member-updated', onAddOrUpdate);
  map.on('member-removed', onRemoved);

  return function detach() {
    map.off?.('member-added',   onAddOrUpdate);
    map.off?.('member-updated', onAddOrUpdate);
    map.off?.('member-removed', onRemoved);
  };
}

/**
 * Convenience: load + attach in one call.
 *
 * @returns {Promise<{ map: MemberMap, detach: () => void }>}
 */
async function bootstrap(args) {
  const map = await load(args);
  const detach = attach({ ...args, map });
  return { map, detach };
}

export const MemberMapCache = Object.freeze({ load, attach, bootstrap });

/**
 * RevealsCache — Pinboard V2 Phase 29.1 (2026-05-07).
 *
 * Auto-persist a `Reveals` instance through any `core.DataSource`
 * (typically the bundle's `CachingDataSource`).  Mirrors the exact
 * shape of `MemberMapCache`:
 *
 *   - `load({dataSource})`              — read the blob into a fresh
 *                                         `Reveals` (returns empty when
 *                                         the path is empty).
 *   - `attach({reveals, dataSource})`   — listen on Reveals events;
 *                                         every change writes through.
 *   - `bootstrap({dataSource})`         — load + attach combined.
 *
 * Storage path: `mem://pinboard/reveals.json` — a single blob holding
 * the full snapshot (`{groups: [...], peers: [...]}`).
 *
 * **Substrate candidate** (rule of two — first consumer): when a 2nd
 * app needs durable Reveals mirroring, lift this beside
 * `MemberMapCache` into `@onderling/identity-resolver` itself.
 * Tracked in `Project Files/Substrates/substrate-candidates.md`.
 */

import { Reveals } from '@onderling/identity-resolver';

const REVEALS_PATH = 'mem://pinboard/reveals.json';

async function load({ dataSource } = {}) {
  if (!dataSource?.read) throw new TypeError('RevealsCache.load: dataSource required');
  let raw;
  try { raw = await dataSource.read(REVEALS_PATH); } catch { raw = null; }
  if (raw == null) return new Reveals();
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return new Reveals({
      groupReveals: Array.isArray(parsed?.groups) ? parsed.groups : [],
      peerReveals:  Array.isArray(parsed?.peers)  ? parsed.peers  : [],
    });
  } catch {
    return new Reveals();
  }
}

function attach({ reveals, dataSource } = {}) {
  if (!reveals) throw new TypeError('RevealsCache.attach: reveals required');
  if (!dataSource?.write) throw new TypeError('RevealsCache.attach: dataSource.write required');

  const flush = () => {
    try {
      const snap = reveals.list();
      void dataSource.write(REVEALS_PATH, JSON.stringify(snap)).catch(() => {});
    } catch { /* persistence is best-effort */ }
  };

  reveals.on('group-reveal-changed', flush);
  reveals.on('peer-reveal-changed',  flush);
  reveals.on('peer-reveal-cleared',  flush);

  return function detach() {
    reveals.off?.('group-reveal-changed', flush);
    reveals.off?.('peer-reveal-changed',  flush);
    reveals.off?.('peer-reveal-cleared',  flush);
  };
}

async function bootstrap(args) {
  const reveals = await load(args);
  const detach  = attach({ ...args, reveals });
  return { reveals, detach };
}

export const RevealsCache = Object.freeze({ load, attach, bootstrap });
export const REVEALS_STORAGE_PATH = REVEALS_PATH;

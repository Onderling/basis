/**
 * `manifest.meActions` — the actions at the top of the person's own page (Me): "Share my card" and "Scan" (2026-10-09).
 * The tab NavItem shape, validated by the same helper and projected verbatim, so both shells paint them from the
 * declaration.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest, renderWeb, renderMobile } from '../src/index.js';

const base = {
  app: 'x', version: '0.0.1',
  operations: [{ id: 'me', verb: 'list', params: [], surfaces: { page: { kind: 'screen', route: 'mij', title: 'Me' } } }],
};

describe('meActions', () => {
  const m = { ...base, meActions: [
    { id: 'share-card', labelKey: 'a.share', target: { kind: 'nav', to: 'shareContact' } },
    { id: 'scan', labelKey: 'a.scan', target: { kind: 'nav', to: 'scan' } },
  ] };
  it('validates like tabs', () => {
    expect((validateManifest(m).errors ?? []).filter((e) => String(e.path).startsWith('/meActions'))).toEqual([]);
    const bad = validateManifest({ ...base, meActions: 'nope' });
    expect((bad.errors ?? []).some((e) => e.path === '/meActions')).toBe(true);
  });
  it('projects verbatim, in order, on both renderers', () => {
    for (const r of [renderWeb, renderMobile]) {
      expect(r(m).meActions.map((a) => a.id)).toEqual(['share-card', 'scan']);
      expect(r(m).meActions[0].target).toEqual({ kind: 'nav', to: 'shareContact' });
    }
  });
  it('absent → no meActions key', () => {
    expect(renderWeb(base).meActions).toBeUndefined();
  });
});

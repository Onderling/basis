/**
 * `manifest.myDataActions` — the doors at the top of My data (the views Me gave up: availability, connection points,
 * shared with me, blocked; 2026-10-15). The tab NavItem shape, validated by the same helper (a nav that names an op is
 * refused), projected verbatim — both shells paint them from the declaration, never from a list of their own.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest, renderWeb, renderMobile } from '../src/index.js';

const base = { app: 'x', version: '0.0.1', operations: [{ id: 'scanQr', verb: 'list', params: [], surfaces: { slash: { command: '/scan-qr' } } }] };

describe('myDataActions', () => {
  const m = { ...base, myDataActions: [
    { id: 'availability', labelKey: 'a.availability', target: { kind: 'nav', to: 'availability' } },
    { id: 'blocked', labelKey: 'a.blocked', target: { kind: 'nav', to: 'blocked' } },
  ] };
  it('validates like tabs; a nav that names an op is refused', () => {
    expect((validateManifest(m).errors ?? []).filter((e) => String(e.path).startsWith('/myDataActions'))).toEqual([]);
    expect((validateManifest({ ...base, myDataActions: 'nope' }).errors ?? []).some((e) => e.path === '/myDataActions')).toBe(true);
    const shadow = validateManifest({ ...base, myDataActions: [{ id: 's', labelKey: 'k', target: { kind: 'nav', to: 'scanQr' } }] }, { strict: true });
    expect((shadow.errors ?? []).some((e) => e.code === 'nav-shadows-op')).toBe(true);
  });
  it('projects verbatim, in order, on both renderers', () => {
    for (const r of [renderWeb, renderMobile]) {
      expect(r(m).myDataActions.map((a) => a.id)).toEqual(['availability', 'blocked']);
      expect(r(m).myDataActions[1].target).toEqual({ kind: 'nav', to: 'blocked' });
    }
  });
  it('absent → no myDataActions key', () => {
    expect(renderWeb(base).myDataActions).toBeUndefined();
  });
});

// Tests for the cross-scope reference-leak guard (scripts/lint-scope-leaks.mjs).
//   npm run test:scope   (root)  →  vitest run scripts/lint-scope-leaks.test.mjs
//
// Covers: a real parent-scope leak IS flagged; legit in-scope references (props,
// locals, module bindings, runtime globals) are NOT; and the forward-protection
// invariant — the scanned RN shell is CLEAN today, so any new sibling-scope leak
// (a `CircleDetail` referencing the parent's `bundle`/`onCircleControl`) fails here.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findScopeLeaks, scopedFiles, RUNTIME_GLOBALS } from './lint-scope-leaks.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const names = (src) => findScopeLeaks(src).map((l) => l.name);

// Two sibling top-level components — `Detail` references `bundle`/`onCircleControl`
// which are bound only in `Screen`'s scope (unreachable from a sibling function).
const LEAKY = `
function Screen({ bundle }) {
  const onCircleControl = () => {};
  const [circleTransport] = useState(null);
  return <Detail callSkill={bundle.callSkill} onControl={onCircleControl} />;
}
function Detail({ callSkill }) {
  const local = 1;
  const wire = () => bundle.coreAgent.identity;               // leak: bundle
  const relay = () => onCircleControl('set-relay', {});       // leak: onCircleControl
  const ts = circleTransport || {};                           // leak: circleTransport
  return <View>{local}{callSkill}{wire}{relay}{ts}</View>;
}`;

// The same file, fixed the way the real bug was: the parent values are threaded
// in as PROPS, so every reference resolves in Detail's own scope.
const FIXED = `
function Screen({ bundle }) {
  const onCircleControl = () => {};
  const [circleTransport] = useState(null);
  return <Detail callSkill={bundle.callSkill} coreIdentity={bundle.coreAgent.identity}
    onCircleControl={onCircleControl} circleTransport={circleTransport} />;
}
function Detail({ callSkill, coreIdentity, onCircleControl, circleTransport }) {
  const wire = () => coreIdentity;
  const relay = () => onCircleControl('set-relay', {});
  const ts = circleTransport || {};
  return <View>{callSkill}{wire}{relay}{ts}</View>;
}`;

describe('scope-leak guard', () => {
  it('flags parent-scope references leaked into a sibling component', () => {
    const flagged = names(LEAKY);
    expect(flagged).toContain('bundle');
    expect(flagged).toContain('onCircleControl');
    expect(flagged).toContain('circleTransport');
    // `useState`/`View` are host/import-like unresolved names too — the point is the
    // three real leaks are caught; we don't assert the absence of those here.
  });

  it('does NOT flag values threaded in as props (the fix)', () => {
    const flagged = names(FIXED);
    expect(flagged).not.toContain('bundle');
    expect(flagged).not.toContain('coreIdentity');
    expect(flagged).not.toContain('onCircleControl');
    expect(flagged).not.toContain('circleTransport');
  });

  it('does NOT flag runtime globals or in-scope locals', () => {
    const src = `function C() {
      const x = JSON.stringify({});
      const y = Math.max(1, 2);
      const t = setTimeout(() => {}, 0);
      console.log(x, y, t);
      return <React.Fragment>{x}</React.Fragment>;
    }`;
    expect(names(src)).toEqual([]);
    for (const g of ['JSON', 'Math', 'setTimeout', 'console', 'React']) {
      expect(RUNTIME_GLOBALS.has(g)).toBe(true);
    }
  });

  it('member access, object keys, and JSX attribute names are never treated as references', () => {
    // `foo.bar` (bar), `{ key: 1 }` (key), `<C prop={1}/>` (prop) must NOT be flagged.
    const src = `function C({ foo }) { const o = { key: foo.bar }; return <D prop={o.key} />; }`;
    // only `D` (a sibling/import-like) may surface; foo/o are in scope, bar/key/prop are not references.
    expect(names(src)).not.toContain('bar');
    expect(names(src)).not.toContain('key');
    expect(names(src)).not.toContain('prop');
  });

  it('forward protection: the scanned RN shell is clean today', () => {
    const dirty = [];
    for (const rel of scopedFiles()) {
      const leaks = findScopeLeaks(readFileSync(join(REPO_ROOT, rel), 'utf8'));
      if (leaks.length) dirty.push(`${rel}: ${leaks.map((l) => `${l.name}@${l.line}`).join(', ')}`);
    }
    expect(dirty, `cross-scope leaks found:\n${dirty.join('\n')}`).toEqual([]);
  });
});

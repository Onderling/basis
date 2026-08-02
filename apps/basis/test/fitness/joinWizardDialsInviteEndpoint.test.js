/**
 * FITNESS — every host that renders the join wizard passes the invite-endpoint seams (J-CP1).
 *
 * An invite names the circle's endpoint. `joinGroupState.js` will dial it BEFORE the peer-redeem, but only
 * if the host handed it the two seams that make that possible: `dialEndpoint` (put this device on that
 * endpoint) and `activeEndpointUrl` (what it is on now, so an already-correct endpoint is not re-dialled).
 * Without them the redeem goes out over whatever transport the device happens to have, waits out a
 * handshake timeout, and the join fails or crawls.
 *
 * The bug this guards against: the fix was wired on the v2 launcher and on web, and NOT on
 * `basis-mobile/src/screens/ChatScreen.js` — which is precisely where a TAPPED INVITE LINK lands. Two of
 * three hosts correct is indistinguishable from three of three unless something counts them, so:
 * find the render sites, read the props they actually pass, and require both seams at each.
 *
 * A fourth host is fine; a fourth host that forgets is not.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));

const REPO = dir('../../../..');

/** The shell source trees. Tests are excluded on purpose — a test may legitimately omit a seam. */
const SHELL_ROOTS = [
  dir('../../web'),
  dir('../../src/rn'),
  dir('../../src/web'),
  dir('../../../basis-mobile/src'),
];

const SEAMS = ['dialEndpoint', 'activeEndpointUrl'];

function jsFiles(root) {
  const out = [];
  const walk = (d) => {
    let entries; try { entries = readdirSync(d); } catch { return; }
    for (const name of entries) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(name) && !/\.test\./.test(name)) out.push(full);
    }
  };
  walk(root);
  return out;
}

/**
 * The props text of the JSX element opening at `start` (`<Foo` … `>`), brace-aware so an object literal
 * or an arrow body inside a prop does not end the element early.
 */
function jsxProps(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const c = src[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) return src.slice(start, i);
  }
  return src.slice(start);
}

/** The argument text of the call whose `(` most closely precedes `at`, paren-balanced. */
function enclosingCallArgs(src, at) {
  let open = -1;
  for (let i = at; i >= 0; i -= 1) { if (src[i] === '(') { open = i; break; } }
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) return src.slice(open, i); }
  }
  return src.slice(open);
}

/**
 * Every place a shell mounts the join wizard, as `{ file, line, props }`.
 *
 * Three shapes exist, and all three must be found — the miss happened on the indirect one:
 *   - `<JoinGroupWizardModal …>`            direct mount (v2 launcher)
 *   - `<WizardComponent …>` via the registry the join wizard is IN (chat shell, deep-linked invites)
 *   - `renderJoinGroupWizard` handed to a web mount adapter (web circle app)
 */
function joinWizardMounts() {
  const found = [];
  const push = (file, src, index, props) => {
    found.push({ file: relative(REPO, file), line: src.slice(0, index).split('\n').length, props });
  };
  for (const root of SHELL_ROOTS) {
    for (const file of jsFiles(root)) {
      const src = readFileSync(file, 'utf8');
      // …the join wizard's own implementation files are not hosts.
      if (/export\s+(default\s+)?function\s+(JoinGroupWizardModal|renderJoinGroupWizard)\b/.test(src)) continue;

      for (const m of src.matchAll(/<JoinGroupWizardModal\b/g)) push(file, src, m.index, jsxProps(src, m.index));

      // The registry host renders whatever `wizardModalFor(opId)` resolved to — which includes this wizard.
      if (/\bwizardModalFor\s*\(/.test(src)) {
        for (const m of src.matchAll(/<([A-Z][A-Za-z0-9_]*)\b/g)) {
          if (!/Wizard/.test(m[1])) continue;
          push(file, src, m.index, jsxProps(src, m.index));
        }
      }

      for (const m of src.matchAll(/\brenderJoinGroupWizard\b/g)) {
        const before = src.slice(Math.max(0, m.index - 200), m.index);
        if (/import[^;]*$/.test(before)) continue;          // the import statement is not a mount
        push(file, src, m.index, enclosingCallArgs(src, m.index));
      }
    }
  }
  return found;
}

describe('the join wizard is always given the invite endpoint (J-CP1)', () => {
  const mounts = joinWizardMounts();

  it('finds every host that mounts it', () => {
    // Guards the guard: if the mount shapes are refactored away this test must fail loudly rather than
    // silently pass over zero hosts.
    expect(mounts.length).toBeGreaterThanOrEqual(3);
    expect(mounts.map((m) => m.file)).toEqual(expect.arrayContaining([
      'apps/basis/web/v2/circleApp.js',
      'apps/basis-mobile/src/screens/ChatScreen.js',
      'apps/basis-mobile/src/screens/v2/CircleLauncherScreen.js',
    ]));
  });

  it('and every one of them passes both endpoint seams', () => {
    const missing = mounts
      .map((m) => ({ at: `${m.file}:${m.line}`, seams: SEAMS.filter((s) => !m.props.includes(s)) }))
      .filter((m) => m.seams.length > 0);
    expect(missing).toEqual([]);
  });
});

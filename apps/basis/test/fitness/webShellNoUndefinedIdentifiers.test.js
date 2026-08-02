/**
 * FITNESS — no web-shell file may reference an identifier that is not in scope.
 *
 * The mobile twin of this guard has existed since 2026-07-30, written after three stacked render
 * `ReferenceError`s made the circle launcher a dead button. **Web had no equivalent**, and on 2026-08-02 it
 * cost exactly what you would expect: `circleApp.js` used `bootRelayUrl` at module scope and never imported
 * it, so loading the web shell threw before anything rendered. Not a degraded screen — a **blank page**.
 *
 * It survived because nothing executes these files. The unit suites import modules from `src/`, and the
 * browser suite could not start (its dev server was broken by a separate config fault), so the shell we had
 * chosen to ship first was the least-executed code in the repo.
 *
 * A linter with `no-undef` would catch this and the repo has no ESLint, so: real scope analysis with the
 * Babel parser already in the tree. Every identifier reference must resolve to a binding, an import, or an
 * explicitly listed global — an unknown name is a bug, which is why the list is explicit rather than broad.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default ?? _traverse;

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(here, '..', '..', 'web');

/** Every .js under web/, recursively. */
function webFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...webFiles(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** What a browser module may legitimately reach for. Explicit on purpose — see the header. */
const KNOWN_GLOBALS = new Set([
  'globalThis', 'console', 'Math', 'JSON', 'Date', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'Promise', 'Set', 'Map', 'WeakMap', 'WeakSet', 'Symbol', 'Error', 'TypeError', 'RangeError',
  'RegExp', 'Intl', 'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'undefined', 'NaN', 'Infinity', 'BigInt',
  'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Float32Array', 'Float64Array',
  'ArrayBuffer', 'DataView', 'TextEncoder', 'TextDecoder', 'structuredClone', 'atob', 'btoa',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'queueMicrotask', 'requestIdleCallback',
  // browser runtime
  'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'fetch', 'URL', 'URLSearchParams', 'AbortController', 'FormData', 'Blob', 'File', 'FileReader',
  'WebSocket', 'XMLHttpRequest', 'Headers', 'Request', 'Response', 'Image', 'Audio', 'Notification',
  'Event', 'CustomEvent', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'CSS', 'DOMParser', 'XPathResult', 'getComputedStyle', 'matchMedia', 'alert', 'confirm', 'prompt',
  'crypto', 'performance', 'indexedDB', 'IDBKeyRange', 'caches', 'Worker', 'MessageChannel',
  'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'NodeFilter', 'Element',
  'AudioContext', 'webkitAudioContext', 'MediaRecorder', 'RTCPeerConnection', 'BroadcastChannel',
  'scrollTo', 'open', 'close', 'print', 'process', 'require', 'module', 'exports', 'import',
  // service-worker scope (web/sw.js) — legitimate, not a missing import
  'self', 'clients', 'caches', 'skipWaiting', 'registration',
]);

/**
 * Known-undefined references, recorded 2026-08-02 so this guard can GATE while the backlog is triaged.
 *
 * Each is a real latent `ReferenceError` on the shell we are shipping — the path that touches it throws
 * when it runs. They are listed rather than silently allowed because the list is the work:
 *
 *   circleApp.js  publishEventToLog:2193 · agent:4019 · getThemePref:6428 · onSetTheme:6429 ·
 *                 policyFor / userDefault / embedProviders:6682   (three in one call)
 *   circleApp.js  Buffer:4577 — a NODE global in a browser bundle. Harmless today only because the
 *                 `typeof btoa === 'function'` branch above it always wins in a browser.
 *   circleMij.js  lang:181
 *
 * Do not grow this. Removing an entry is the fix; adding one needs a reason.
 */
const KNOWN_UNDEFINED = new Map([
  ['web/v2/circleApp.js', ['Buffer', 'agent', 'embedProviders', 'getThemePref', 'onSetTheme', 'policyFor', 'publishEventToLog', 'userDefault']],
  ['web/v2/circleMij.js', ['lang']],
]);

const files = webFiles(WEB_DIR);

describe('FITNESS — every identifier in the web shell resolves', () => {
  it('finds web files to check at all', () => {
    // a guard that silently checks nothing is worse than no guard
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    const rel = path.relative(path.join(here, '..', '..'), file);
    it(`${rel} references nothing undefined`, () => {
      const code = readFileSync(file, 'utf8');
      let ast;
      try {
        ast = parse(code, { sourceType: 'module', errorRecovery: true, plugins: ['topLevelAwait'] });
      } catch (err) {
        throw new Error(`${rel} does not parse: ${err.message}`);
      }

      const undefined_ = new Set();
      traverse(ast, {
        ReferencedIdentifier(p) {
          const name = p.node.name;
          if (KNOWN_GLOBALS.has(name)) return;
          if (p.scope.hasBinding(name, /* noGlobals */ true)) return;
          // labels, member properties and object keys are not references to a binding
          if (p.parentPath?.isMemberExpression?.({ property: p.node }) && !p.parent.computed) return;
          undefined_.add(name);
        },
      });

      const allowed = new Set(KNOWN_UNDEFINED.get(rel.replace(/\\/g, '/')) ?? []);
      const fresh = [...undefined_].filter((n) => !allowed.has(n)).sort();
      expect(fresh, `${rel} uses identifiers that resolve to nothing`).toEqual([]);
    });
  }
});

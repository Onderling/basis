/**
 * FITNESS — no screen may reference an identifier that is not in scope.
 *
 * `src/screens/**` is excluded from vitest (see `docs/agent-notes-known-gotchas.md`), and CLAUDE.md's standing
 * instruction is therefore to grep every identifier you introduce against the file you put it in, because
 * nothing else will catch a typo there. On 2026-07-30 that blind spot cost most of an afternoon: opening ANY
 * circle was impossible, and it took two stacked bugs of exactly this shape to do it.
 *
 *   1. `App.js` passed `onAcceptFallback` to `CircleLauncherScreen`, which never destructured it — so the
 *      render forwarded a bare identifier that existed in no scope.
 *   2. One prop further down, `CircleDetail` read `selectedPolicy`, which is the LAUNCHER's state variable.
 *      Inside `CircleDetail` the same value arrives as `policy`. The name reads perfectly plausibly in the
 *      file it sits in — the two components live in one file — and it resolved to nothing.
 *
 * Both are `ReferenceError: Property 'x' doesn't exist` at RENDER time. That is the nastiest possible failure
 * mode for a tap handler: the handler runs, the skills fire, the log looks healthy, and then the render it
 * caused dies. It reads as a dead button. Diagnosing it needed a probe on the Pressable to prove the press
 * had been working all along.
 *
 * A linter with `no-undef` would catch this, and this repo has no ESLint. So: real scope analysis, using the
 * Babel parser and traverse that are already in the tree. Every identifier reference must resolve to a
 * binding, a known global, or a documented exception below.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

// @babel/traverse ships CJS; under ESM the callable is on `.default`.
const traverse = _traverse.default ?? _traverse;

const here = path.dirname(fileURLToPath(import.meta.url));
const SCREENS_DIR = path.join(here, '..', 'src', 'screens');

/** Every .js under src/screens, recursively. */
function screenFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...screenFiles(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Globals a React Native screen legitimately reaches for. Deliberately explicit rather than a broad
 * allowlist: the whole point is that an unknown name is a bug, so anything new has to be justified here.
 */
const KNOWN_GLOBALS = new Set([
  // JS / platform
  'globalThis', 'console', 'Math', 'JSON', 'Date', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'Promise', 'Set', 'Map', 'WeakMap', 'WeakSet', 'Symbol', 'Error', 'TypeError', 'RangeError',
  'RegExp', 'Intl', 'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'undefined', 'NaN', 'Infinity', 'BigInt',
  'Uint8Array', 'ArrayBuffer', 'TextEncoder', 'TextDecoder', 'structuredClone', 'atob', 'btoa',
  // timers + microtasks
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'queueMicrotask', 'setImmediate', 'clearImmediate',
  // RN / web-ish runtime
  'fetch', 'URL', 'URLSearchParams', 'AbortController', 'FormData', 'Blob', 'File', 'FileReader',
  'WebSocket', 'XMLHttpRequest', 'Headers', 'Request', 'Response', 'process', 'require', 'module',
  'exports', '__DEV__', 'performance', 'crypto', 'navigator', 'window', 'document', 'alert',
  'localStorage', 'sessionStorage', 'Event', 'CustomEvent', 'HermesInternal', 'global',
]);

const files = screenFiles(SCREENS_DIR);

describe('FITNESS: every identifier a screen references is in scope', () => {
  it('finds screen files to check at all', () => {
    // A guard that silently checks nothing is worse than no guard.
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(files.map((f) => [path.relative(SCREENS_DIR, f), f]))('%s', (_rel, file) => {
    const code = readFileSync(file, 'utf-8');
    const ast = parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'objectRestSpread', 'optionalChaining', 'nullishCoalescingOperator'],
    });

    const unresolved = [];
    traverse(ast, {
      ReferencedIdentifier(p) {
        const { name } = p.node;
        if (KNOWN_GLOBALS.has(name)) return;
        // JSX element names resolve as identifiers too; lowercase ones are intrinsic RN/host tags.
        if (p.parentPath.isJSXOpeningElement?.() && /^[a-z]/.test(name)) return;
        if (p.scope.hasBinding(name, /* noGlobals */ true)) return;
        unresolved.push(`${name} (line ${p.node.loc?.start.line})`);
      },
    });

    expect(
      [...new Set(unresolved)],
      'these names are referenced but bound nowhere — a ReferenceError the moment the branch renders. '
      + 'Usually a prop App.js passes that this component never destructured, or a value that belongs to a '
      + 'SIBLING component in the same file (the `selectedPolicy` vs `policy` shape).',
    ).toEqual([]);
  });
});

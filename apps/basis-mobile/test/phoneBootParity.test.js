/**
 * FITNESS — the phone in Node boots with the options the phone boots with.
 *
 * `test/support/mobileNode.js` is only evidence about the phone while it composes the phone: same factory, same
 * options. App.js is the phone's boot; this reads both `bootAgentBundle({ … })` calls and holds the helper to App.js's
 * option list. A new option on the phone that the helper does not pass turns this red, so an M story can never go
 * green on a composition the phone no longer has (the walk-harness lesson: a harness missing the device log fanned
 * nothing, and two "product defects" were the harness).
 *
 * The receive side needs no such list: both call `buildPhoneInboundWiring`, and the fitness tests in
 * apps/basis/test/fitness hold ChatScreen to it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** The top-level keys of the object literal passed to the first `bootAgentBundle({` in `src`. */
function bootOptionKeys(src) {
  const start = src.indexOf('bootAgentBundle({');
  if (start < 0) return null;
  const body = src.slice(start + 'bootAgentBundle('.length);
  // strip comments, then walk the braces: keys are names followed by `:` or `,` at depth 1
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const keys = new Set();
  let depth = 0; let prev = '';   // prev = the last non-space character seen at depth 1
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i];
    if (/\s/.test(c)) continue;
    if (depth === 1 && (prev === '{' || prev === ',')) {
      // a key begins right after `{` or `,`: `name:`, shorthand `name,` / `name}`, or a spread
      const m = /^([A-Za-z_$][\w$]*)\s*[:,}]/.exec(code.slice(i));
      if (m) keys.add(m[1]);
    }
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') { depth -= 1; if (depth === 0) break; }
    if (depth === 1) prev = c;
  }
  return keys;
}

/** Options only one side passes, each with its reason. Adding here is a decision, not a way to go green. */
const PHONE_ONLY = {
  secureStore: 'the OS keystore (expo-secure-store) guards the owner-root seed; Node has none, and no story restores from a phrase yet',
};
const NODE_ONLY = {
  nknLib: 'the bundle\'s test seam: a stub client that never dials, so delivery runs over the test relay alone',
};

describe('FITNESS — the phone in Node passes the phone\'s boot options', () => {
  const app = bootOptionKeys(read('../App.js'));
  const node = bootOptionKeys(read('./support/mobileNode.js'));

  it('finds both boot calls', () => {
    expect(app?.size, 'App.js: bootAgentBundle({ … }) not found or empty').toBeGreaterThan(20);
    expect(node?.size, 'mobileNode.js: bootAgentBundle({ … }) not found or empty').toBeGreaterThan(20);
  });

  it('every option App.js boots the phone with, the Node phone passes too', () => {
    const missing = [...app].filter((k) => !node.has(k) && !PHONE_ONLY[k]);
    expect(missing, 'options the phone boots with that mobileNode.js does not pass — compose them the way App.js does').toEqual([]);
  });

  it('the Node phone passes nothing the phone does not, beyond its declared test seam', () => {
    const extra = [...node].filter((k) => !app.has(k) && !NODE_ONLY[k]);
    expect(extra, 'options only the Node phone passes').toEqual([]);
  });

  it('keeps the declared differences honest', () => {
    expect(Object.keys(PHONE_ONLY).filter((k) => !app.has(k) || node.has(k)), 'listed as phone-only, but it is not').toEqual([]);
    expect(Object.keys(NODE_ONLY).filter((k) => !node.has(k) || app.has(k)), 'listed as Node-only, but it is not').toEqual([]);
  });
});

describe('FITNESS — the phone in Node composes what the screens compose, through the same src/core functions', () => {
  const launcher = read('../src/screens/v2/CircleLauncherScreen.js');
  const chat = read('../src/screens/ChatScreen.js');
  const node = read('./support/mobileNode.js');
  it('the ops on the waist: the launcher and the Node phone both mount through mountPhoneAppOps', () => {
    expect(launcher).toMatch(/mountPhoneAppOps\(/);
    expect(node).toMatch(/mountPhoneAppOps\(/);
    expect(launcher, 'the launcher mounts an op table of its own beside the shared one').not.toMatch(/mountAppOps\(/);
  });
  it('the receive path: ChatScreen and the Node phone both build through buildPhoneInboundWiring', () => {
    expect(chat).toMatch(/buildPhoneInboundWiring\(/);
    expect(node).toMatch(/buildPhoneInboundWiring\(/);
  });
});

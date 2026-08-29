/**
 * The peer-wiring builder must take the boot bundle as a PARAMETER — never read the prop it captured.
 *
 * `buildPeerWiring` is a `useCallback(…, [])` with an empty dependency array, deliberately: the wiring is
 * built once and attached once. That makes every OUTER value its body reads a snapshot of the FIRST render
 * — and on the first render the `bundle` prop is still `null`, because App.js has not finished booting the
 * agent yet.
 *
 * On 2026-08-29 that turned the entire inbound peer router OFF on a real device. Every lane was read from
 * the stale null (`bundle?.agent?.circleIdentityFor`, `?.membershipRail`, `?.taskRail`, `?.chatRail`,
 * `?.keyRail`, `?.grantsPeerHandler`, `?.rosterSeed`, and every `callSkill: bundle.callSkill`), so they all
 * came out null. The governance one is simply the only rail whose absence THROWS — by design, because a
 * fanned statement must verify before it lands — and it throws inside the handler-map literal, in an effect
 * with no try/catch, so `attachPeerWiring` was never called at all. The phone could send and could not
 * receive, and the UI painted perfectly the whole time.
 *
 * Nothing else can catch this: `src/screens/**` is excluded from vitest (see
 * docs/agent-notes-known-gotchas.md), which is exactly why this guard reads the source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(HERE, '../src/screens/ChatScreen.js'), 'utf8');

/** The parameter list of `buildPeerWiring` — the text between `useCallback(` and its `=>`. */
function peerWiringParams() {
  const start = SRC.indexOf('const buildPeerWiring = useCallback(');
  if (start < 0) return null;
  const arrow = SRC.indexOf('=>', start);
  return arrow < 0 ? null : SRC.slice(start, arrow);
}

describe('the mobile peer wiring', () => {
  it('exists as a single-build useCallback', () => {
    expect(peerWiringParams(), 'buildPeerWiring should be a useCallback in ChatScreen').not.toBeNull();
  });

  it('takes the boot bundle as a parameter, so it cannot read the first-render null', () => {
    expect(
      /\bbundle\b/.test(peerWiringParams() ?? ''),
      'buildPeerWiring reads `bundle` in its body but does not DECLARE it — with an empty dep array that is '
      + 'the first render\'s value, which is null, so every rail it derives is null and the governance '
      + 'handler throws before attachPeerWiring is ever called',
    ).toBe(true);
  });

  it('is CALLED with the live bundle', () => {
    expect(
      /buildPeerWiring\(\{[^}]*\bbundle\b\s*:/s.test(SRC),
      'the effect must pass the booted bundle into buildPeerWiring({ bundle: … })',
    ).toBe(true);
  });
});

/**
 * FITNESS FUNCTION — every send to a Nearby room peer speaks as the room key, and none goes without one.
 *
 * A room peer is a stranger; the room key is the only identity this device shows them. A send that left as the agent's
 * own identity would hand that stranger the person's canonical address. So the room has ONE place that sends, and it
 * passes `requireSendAs` (the agent refuses the send outright when the room identity is gone):
 *
 *   1. in nearbyRoomBinding.js the agent's `sendPeerMessage` is called once, inside `sendAsRoom`, with `sendAs` and
 *      `requireSendAs: true`; nothing else in the file reaches it (no second call, no hand-off of the function itself);
 *   2. the delivery receipt, which the shell's receipt sender writes, is handed `via: sendAsRoom` at every call of the
 *      shell's hook, so the shell keeps the policy (the person's setting) and the room keeps the identity;
 *   3. no other Nearby module in a shell or in shared code calls `sendPeerMessage` itself.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const repo = path.resolve(__dirname, '../../../..');
const BINDING = 'apps/basis/src/v2/nearbyRoomBinding.js';
// line and block comments out, so a sentence about the function is not counted as a use of it
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('a Nearby room send speaks as the room key', () => {
  const src = code(readFileSync(path.join(repo, BINDING), 'utf8'));

  it('the agent send is reached once, in sendAsRoom, with requireSendAs', () => {
    const calls = src.match(/sendPeerMessage\s*\(/g) ?? [];
    expect(calls).toHaveLength(1);
    const body = src.slice(src.indexOf('const sendAsRoom'), src.indexOf('const inRoom'));
    expect(body).toMatch(/sendPeerMessage\s*\(\s*address\s*,\s*payload\s*,\s*\{[^}]*sendAs:\s*me[^}]*requireSendAs:\s*true/);
    // every other mention is the parameter itself (the destructure and its type check), never a hand-off; quoted text
    // (the type check's error message) is not a use
    const mentions = src.replace(/'[^'\n]*'/g, "''").match(/\bsendPeerMessage\b/g) ?? [];
    expect(mentions).toHaveLength(3);
  });

  it('every call of the shell\'s receipt hook hands it the room sender', () => {
    const hookCalls = src.match(/landedHook\s*\(\s*\{[^}]*\}/g) ?? [];
    expect(hookCalls.length).toBeGreaterThan(0);
    for (const c of hookCalls) expect(c).toMatch(/via:\s*sendAsRoom\b/);
  });

  it('no other Nearby module calls the agent send itself', () => {
    let hits = '';
    try {
      hits = execSync(
        "git grep -l -e 'sendPeerMessage(' -- 'apps/basis/src/v2/nearby*' 'apps/basis/web/**/*earby*' 'apps/basis-mobile/src/**/*earby*'",
        { cwd: repo, encoding: 'utf8' },
      );
    } catch (err) {
      if (err.status !== 1) throw err;   // 1 = no match
    }
    expect(hits.trim().split('\n').filter(Boolean)).toEqual([BINDING]);
  });
});

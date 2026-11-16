/**
 * THE CLOSED SET COVERS THE CONTACT DOOR. A message-request hold the door's first call refused is written to the
 * refusal log with its reason, then held anyway. A reason added to the hold without its code would be logged as
 * 'other'; a code whose reason is gone is dead. Both directions, read from the sources that return them.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { refusalCode, DOOR_REFUSAL_CODES } from '../../src/v2/refusalLog.js';

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const SOURCES = [
  at('../../../pinboard/src/lib/MessageRequests.js'),   // the hold itself
  at('../../../pinboard/src/skills/index.js'),          // its skill (no store, a throw)
  at('../../src/v2/messageRequestDoor.js'),             // the door, when the hold answered without a code
];

/** Every `reason: '…'` literal in the hold's sources, and every quoted code in the door's tryHold fallback. */
function reasonsInSources() {
  const found = new Set();
  const hold = readFileSync(SOURCES[0], 'utf8');
  for (const m of hold.matchAll(/reason:\s*(?:[^'\n]*\?\s*)?'([a-z-]+)'(?:\s*:\s*'([a-z-]+)')?/g)) { found.add(m[1]); if (m[2]) found.add(m[2]); }
  const skills = readFileSync(SOURCES[1], 'utf8');
  const holdSkill = skills.slice(skills.indexOf("defineSkill('holdMessageRequest'"), skills.indexOf("defineSkill('acceptMessageRequest'"));
  for (const m of holdSkill.matchAll(/reason:\s*'([a-z-]+)'/g)) found.add(m[1]);
  const door = readFileSync(SOURCES[2], 'utf8');
  const tryHold = door.slice(door.indexOf('const tryHold'), door.indexOf('const refused'));
  for (const m of tryHold.matchAll(/(?:reason:|\?|:)\s*'([a-z]+(?:-[a-z]+)*)'/g)) found.add(m[1]);   // a reason or a ternary's arm
  return [...found];
}

describe('the refusal codes cover the contact door', () => {
  const reasons = reasonsInSources();

  it('finds the reasons in the sources (the reader itself works)', () => {
    expect(reasons).toEqual(expect.arrayContaining(['no-card', 'malformed-card', 'card-not-sender', 'file-on-request', 'no-self', 'hold-threw']));
  });

  it('every reason the hold returns has a code in the closed set', () => {
    expect(reasons.filter((r) => ['other', 'unknown'].includes(refusalCode(r).reason))).toEqual([]);
  });

  it('every door code is still returned by one of its sources', () => {
    expect(DOOR_REFUSAL_CODES.filter((c) => !reasons.includes(c))).toEqual([]);
  });
});

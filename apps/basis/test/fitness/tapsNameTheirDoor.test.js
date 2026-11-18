/**
 * A person's tap that writes in a circle names its door (ledger L1042), so the outer waist asks the circle.
 *
 * @guard every raw-path call of a circle write a person taps names `door: 'tap'`, on web and on the phone
 *
 * The outer waist asks a circle's capability set only for a call that names a person door (`circleActGate.js`, the own
 * record's reading). These are the taps that went past it (the noticeboard's chips, the lists panel): each call site
 * must carry the door, or the walk-around is back. The list is the ops; a new tap of these ops without the door is red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** The circle writes a person taps on a raw path, per shell file (the noticeboard's chips, the lists panel). */
const TAPS = {
  'apps/basis/web/v2/circleApp.js': ['cancelRequest', 'markReturned', 'acceptResponder', 'assignLend', 'markListItemDone', 'removeFromList', 'addToList', 'createList'],
};

/**
 * Calls of these ops that are NOT a person's tap, by count, each with why. Not a door-less tap allowed in: a call
 * here that a person taps is a walk-around.
 */
const NOT_A_TAP = {
  'apps/basis/web/v2/circleApp.js': {
    // `removeReportedItem`: an admin carrying out a governed report decision (the governance layer is its gate),
    // the fallback after `deleteCircleItem` (a call to an op nobody declares: ledger L1048)
    cancelRequest: 1,
  },
};

/** Every call of `op` through pinboardCall / rawCallSkill in `src`, with its full argument text. */
function callsOf(src, op) {
  const out = [];
  const re = new RegExp(`(?:pinboardCall|rawCallSkill)\\('(?:pinboard|lists)',\\s*'${op}'`, 'g');
  for (let m; (m = re.exec(src));) {
    let depth = 0; let i = src.indexOf('(', m.index);
    const start = i;
    for (; i < src.length; i++) { if (src[i] === '(') depth++; else if (src[i] === ')' && --depth === 0) break; }
    out.push(src.slice(start, i + 1));
  }
  return out;
}

describe('a person\'s tap that writes in a circle names its door', () => {
  for (const [file, ops] of Object.entries(TAPS)) {
    it(file, () => {
      const src = read(file);
      for (const op of ops) {
        const calls = callsOf(src, op);
        expect(calls.length, `${op} is tapped in ${file}`).toBeGreaterThan(0);
        const doorless = calls.filter((c) => !/door:\s*'tap'/.test(c)).length;
        expect(doorless, `${op} in ${file}: door-less calls beyond the declared ones`).toBe(NOT_A_TAP[file]?.[op] ?? 0);
      }
    });
  }
});

/**
 * In a shell that holds BOTH waists, the resolving one is never handed an app origin.
 *
 *   resolving:  callSkill(opId, args)                → tries each composed origin
 *   targeted:   rawCallSkill(appOrigin, opId, args)  → this app, this op
 *
 * They differ only in arity, and a shell scope holds both under names one letter apart. A three-argument
 * call to the resolver shifts everything: the app name is read as the op id, the op id as the args, no
 * origin declares an op by that name, and it resolves to NOTHING — silently, because "no origin has it"
 * is a legitimate answer there. It cost two afternoons in one week: a "+" entry that opened, submitted,
 * closed and did nothing, and a fan-out that never fanned. `broadcastCircleFanOut` warns about the same
 * trap in its own docstring, which is a good sign the distinction wants a check rather than a comment.
 *
 * The runtime throws on a third argument now (`makeResolvingCallSkill`). This is the same check one step
 * earlier, and deliberately NARROW: repo-wide, a parameter named `callSkill` is usually the TARGETED one
 * — the name carries no arity. Only in these two files do both live in one scope, and only here can the
 * first argument be judged by whether it names an app.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

/** Every app that declares a manifest, by the origin name a targeted call uses. */
const ORIGINS = new Set(
  readdirSync(path.join(REPO, 'apps'))
    .filter((d) => { try { return statSync(path.join(REPO, 'apps', d, 'manifest.js')).isFile(); } catch { return false; } })
    .map((d) => (d === 'tasks-v0' ? 'tasks' : d))
    .concat(['params']),
);

/** The shells where BOTH waists are in scope — the only place this reading is sound. */
const SHELLS = [
  'apps/basis-mobile/src/screens/v2/CircleLauncherScreen.js',
  'apps/basis/web/v2/circleApp.js',
];

/**
 * `callSkill('x', …)` where the receiver is the RESOLVING one.
 *
 * An AGENT's own `callSkill` is the targeted waist — `agent.callSkill(appOrigin, opId, args)` is the
 * signature `realAgent` exports — and so is anything called `raw*`, or a bundle's. What is left, a bare
 * `callSkill(` in a shell scope, is the resolving prop.
 */
function resolvingCallsWithOrigin(src) {
  const out = [];
  src.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;                 // prose about the trap is not the trap
    for (const m of line.matchAll(/(\w*)\.?callSkill\s*\(\s*'([a-z][\w-]*)'/g)) {
      const receiver = m[1] ?? '';
      if (/agent|bundle|raw|app/i.test(receiver)) continue;   // a targeted waist, correctly given an origin
      if (ORIGINS.has(m[2])) out.push(`${i + 1}: ${line.trim().slice(0, 100)}`);
    }
  });
  return out;
}

describe('the resolving waist is never handed an app origin, in a shell that holds both', () => {
  for (const shell of SHELLS) {
    it(`${shell.split('/').pop()} passes op ids to the resolver, never app names`, () => {
      const offenders = resolvingCallsWithOrigin(read(shell));
      expect(offenders, `a resolving callSkill was given an app origin:\n${offenders.join('\n')}`).toEqual([]);
    });
  }

  it('and the resolver itself refuses a three-argument call rather than resolving to nothing', () => {
    // The runtime half: a caller who reaches for the wrong one gets a sentence, not a null.
    expect(read('apps/basis/src/v2/circleSources.js')).toMatch(/third !== undefined/);
    expect(read('apps/basis/src/v2/circleSources.js')).toMatch(/APP-TARGETED signature/);
  });
});

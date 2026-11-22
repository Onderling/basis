/**
 * A circle write a person makes names its door (ledger L1042), so the outer waist asks the circle.
 *
 * @guard every call, in either shell, of an op the circle's capability check would gate names a person door, or is on the declared list with its reason
 *
 * The outer waist asks a circle's capability set only for a call that names a person door (`circleActGate.js`, the own
 * record's reading). STRUCTURAL, not a hand list: the gated ops come from the manifests (a write, a circle's scope, an
 * atom and noun that name a row: what `circleActRefusal` would check), and the calls are every literal call of such an
 * op, through ANY call helper (`rawCallSkill`, `pinboardCall`, `agent.callSkill`, `bundle.callSkill`, a prop named
 * `callSkill`, …), in the web and the phone sources. A new door-less call of a gated op is red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allManifests } from '../../src/v2/manifestSources.js';
import { verbKind } from '@onderling/app-manifest';
import { effectiveCapabilities, checkCapability } from '../../src/v2/capabilityGate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SHELLS = ['apps/basis/web', 'apps/basis-mobile/src', 'apps/basis/src'];
// the agent's own waist and its handlers are where calls ARRIVE, not people's doors
const NOT_SCANNED = [/apps\/basis\/src\/core\//];
const PERSON_DOOR = /door:\s*'(tap|slash|phrase|model|bot|clock|agent)'/;

/**
 * Calls of a gated op that are NOT a person's act, by `file → app.op → count`, each with why. A person's tap here is a
 * walk-around: add the door instead.
 */
const NOT_A_PERSONS_ACT = {
  'apps/basis/web/v2/circleApp.js': {
    // `removeReportedItem`: an admin carrying out a governed report decision (the governance layer is its gate), the
    // fallback after `deleteCircleItem` (a call to an op nobody declares: ledger L1048)
    'pinboard.cancelRequest': 1,
    // the after-claim hook: the claim was the person's act (and was asked); mirroring it into their own primary circle
    // follows from their own flow-through setting, written by the device for them
    'tasks.addTask': 1,
  },
  'apps/basis-mobile/src/screens/v2/CircleLauncherScreen.js': {
    'tasks.addTask': 1,   // the after-claim hook, the phone's twin of web's
  },
  // shared code
  'apps/basis/src/v2/householdExport.js': {
    'lists.createList': 1,   // restoring an export: the owner's own restore, recreating the household's lists
  },
  'apps/basis/src/v2/householdTemplate.js': {
    'lists.createList': 1,   // the bot's first start making its template's lists: the device's own act
  },
};

/** The ops the circle's capability check gates: a write, a circle's scope, an atom and noun that name a row. */
function gatedOps() {
  const ms = allManifests();
  const eff = effectiveCapabilities(ms.map((m) => ({ manifest: m, appOrigin: m.app })), { apps: null });
  const out = new Set();
  for (const m of ms) for (const op of m.operations ?? []) {
    if (verbKind(m, op.verb) === 'read') continue;
    if (['person', 'device', 'own'].includes(op?.writes?.scope)) continue;
    if (checkCapability({ op, appOrigin: m.app, args: {} }, eff).capability) out.add(`${m.app}.${op.id}`);
  }
  return out;
}

const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = path.join(d, f);
  if (f === 'node_modules') return [];
  return statSync(p).isDirectory() ? walk(p) : (/\.m?jsx?$/.test(f) ? [p] : []);
});

/** Door-less calls of a gated op, `file → app.op → count`. */
function doorlessCalls(gated) {
  const re = /([A-Za-z_$][\w$]*(?:\??\.[\w$]+)*)\??\.?\(\s*'([a-z-]+)'\s*,\s*'([A-Za-z:_-]+)'/g;
  const out = {};
  for (const shell of SHELLS) for (const file of walk(path.join(ROOT, shell)).filter((f) => !NOT_SCANNED.some((r) => r.test(f)))) {
    const src = readFileSync(file, 'utf8');
    for (let m; (m = re.exec(src));) {
      if (!/call/i.test(m[1])) continue;
      const key = `${m[2]}.${m[3]}`;
      if (!gated.has(key)) continue;
      let depth = 0; let i = src.indexOf('(', m.index + m[1].length); const s0 = i;
      for (; i < src.length; i++) { if (src[i] === '(') depth++; else if (src[i] === ')' && --depth === 0) break; }
      if (PERSON_DOOR.test(src.slice(s0, i + 1))) continue;
      const rel = path.relative(ROOT, file);
      out[rel] ??= {}; out[rel][key] = (out[rel][key] ?? 0) + 1;
    }
  }
  return out;
}

describe('a circle write a person makes names its door (structural)', () => {
  const gated = gatedOps();

  it('the manifests name the ops the gate checks (the set is not empty, and holds the walk-arounds L1042 closed)', () => {
    for (const k of ['pinboard.markReturned', 'pinboard.cancelRequest', 'lists.addToList', 'tasks.addTask']) expect(gated.has(k), k).toBe(true);
  });

  it('every door-less call of a gated op, in either shell, is on the declared list (and the list holds nothing stale)', () => {
    expect(doorlessCalls(gated)).toEqual(NOT_A_PERSONS_ACT);
  });
});

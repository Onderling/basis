/**
 * One recovery phrase, one door: the only op that shows a phrase is the host's `revealOwnerPhrase`, and every op that
 * takes a phrase onto this device is the host's. A second phrase door anywhere (an app's own seed reveal or restore)
 * is how a second, unrelated secret ended up in front of a person as "your recovery phrase".
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

const APPS = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function allOps() {
  const out = [];
  for (const app of readdirSync(APPS)) {
    const f = join(APPS, app, 'manifest.js');
    if (!existsSync(f)) continue;
    let mod;
    try { mod = await import(pathToFileURL(f).href); } catch { continue; }
    for (const m of new Set(Object.values(mod))) {
      if (!m || typeof m !== 'object' || !Array.isArray(m.operations)) continue;
      for (const op of m.operations) out.push({ app: m.app ?? app, file: app, id: op.id });
    }
  }
  return out;
}

const PHRASE = /mnemonic|phrase/i;

describe('one phrase door, the host\'s', () => {
  it('exactly one op reveals a phrase, and it is household:revealOwnerPhrase', async () => {
    const reveals = (await allOps()).filter((o) => /reveal|show|getMnemonic/i.test(o.id) && PHRASE.test(o.id));
    expect(reveals.map((o) => `${o.file}:${o.id}`)).toEqual(['household:revealOwnerPhrase']);
  });

  it('every op that takes a phrase onto this device is declared by the host', async () => {
    const phraseOps = (await allOps()).filter((o) => PHRASE.test(o.id));
    expect(phraseOps.length).toBeGreaterThan(1);
    expect(phraseOps.filter((o) => o.file !== 'household').map((o) => `${o.file}:${o.id}`)).toEqual([]);
  });

  it('on a real boot, no in-process agent registers a phrase reveal or restore but the host\'s', { timeout: 120_000 }, async () => {
    const agent = await createRealHouseholdAgent({ seedHousehold: false });
    const ids = agent.inProcessSkillIds();
    const phraseSkills = Object.entries(ids).flatMap(([who, list]) => list.filter((id) => PHRASE.test(id)).map((id) => `${who}:${id}`));
    expect(phraseSkills.filter((s) => !s.startsWith('host:'))).toEqual([]);
    expect(phraseSkills.filter((s) => /reveal|getMnemonic/i.test(s))).toEqual(['host:revealOwnerPhrase']);
  });
});


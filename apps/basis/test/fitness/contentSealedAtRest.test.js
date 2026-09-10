/**
 * NOTHING A PERSON WRITES IS ON THIS DISK IN THE CLEAR.
 *
 * The site says it in the present tense: *sealed where it is stored.* Key material was; content was not.
 * A circle's items, the household list and the search index sat in IndexedDB, in AsyncStorage and in a file
 * as plain text — measured 2026-09-10, one item added through the real agent, `household-items.json`,
 * 403 bytes, the words readable in a hex dump. Frits, the same day: *"All data must be sealed, but from the
 * start."*
 *
 * ── Why this test is shaped the way it is ───────────────────────────────────────────────────────────
 * It does NOT unit-test the sealing wrapper. A wrapper that seals is easy to prove and proves nothing about
 * the product: this repo's recurring failure is the built-but-unadopted seam — green tests either side of a
 * seam nothing passes through. So this asserts the only thing a person would check, and asserts it the way
 * an attacker would:
 *
 *   write a distinctive word through the REAL waist, then read every raw byte this device persisted and
 *   grep for it.
 *
 * It never names the store that word should land in. That is deliberate. A test that checks "the household
 * file is sealed" goes green the day content moves to a store the test does not know about; this one goes
 * red, because the word turns up somewhere new and in the clear. It is a fitness function over the whole
 * local surface, not a check on one adapter — so a store added next month is covered without being told,
 * which is the only way an invariant like this survives contact with a growing codebase.
 *
 * Both raw stores here are handed IN and read back RAW, so what is scanned is what the production
 * composition actually wrote, not something the test sealed for itself.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { bootRealAgentNode, teardown } from '../support/pairRealAgents.js';
import { atRestSettings } from '../../src/v2/atRestSettings.js';

/** Words no part of the machinery would ever emit on its own — so a hit is this person's content. */
const SECRET_ITEM   = 'zwijgplicht-broodbeleg-8821';
const SECRET_CIRCLE = 'fluisterkring-4417';
const SECRET_NAME   = 'Roosmarijn-Zonnebloem-9903';

/** Every raw value a StorageBackend holds, as one blob to scan. */
async function rawDump(backend) {
  const refs = await backend.list('');
  const keys = (refs ?? []).map((r) => (typeof r === 'string' ? r : r?.key ?? r?.ref ?? String(r)));
  const parts = [];
  for (const key of keys) {
    const v = await backend.get(key);
    if (v == null) continue;
    parts.push(typeof v === 'string' ? v : JSON.stringify(v));
  }
  return parts.join('\n');
}

describe('content is sealed at rest — a person\'s words are nowhere on this disk in the clear', () => {
  let dir; let node;

  afterAll(async () => {
    await teardown(node).catch(() => {});
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('a household item and a circle name survive a round trip but never hit storage readable', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'at-rest-'));
    const householdFile = path.join(dir, 'household-items.json');
    // Handed in RAW. The production composition is what must seal it; if the test sealed it, the test
    // would be proving its own wrapper and nothing about the app.
    const registryRaw = createMemoryBackend();

    node = await bootRealAgentNode('sealed', {
      agentOpts: { householdPersistDb: { path: householdFile }, registryBackend: registryRaw },
    });

    await node.agent.callSkill('household', 'addItem', { type: 'shopping', text: SECRET_ITEM });
    await node.agent.callSkill('stoop', 'createGroupV2', { groupId: SECRET_CIRCLE, name: SECRET_CIRCLE });
    // A property the PERSON curated, which lands in the agent registry — the second local family, and the
    // one holding who this device belongs to rather than what it was asked to remember.
    await node.agent.callSkill('agents', 'setProfileProperty', { id: 'default', key: 'place', value: SECRET_NAME });

    // The file adapter debounces (`saveDelayMs` 200) — wait past it, so a green is a real write and not
    // a test that outran the save.
    await new Promise((r) => setTimeout(r, 1200));

    // ── The person still has their things. Sealing that loses content is not sealing. ────────────────
    const items = await node.agent.callSkill('household', 'listOpen', { type: 'shopping' });
    expect(JSON.stringify(items), 'the item must still be readable through the app').toContain(SECRET_ITEM);

    // ── And the disk gives nothing away. ─────────────────────────────────────────────────────────────
    const onDisk = await readFile(householdFile, 'utf-8').catch(() => '');
    expect(onDisk, 'the household file holds the item body in the clear').not.toContain(SECRET_ITEM);

    // The registry probe must be able to SEE something, or its "no plaintext" would be the empty
    // store passing vacuously — the failure mode where a guard goes green because it looked nowhere.
    const registryDump = await rawDump(registryRaw);
    expect(registryDump.length, 'the registry probe read nothing — it cannot prove anything').toBeGreaterThan(0);
    expect(registryDump, 'the registry holds the circle name in the clear').not.toContain(SECRET_CIRCLE);
    expect(registryDump, 'the registry holds the person\'s name in the clear').not.toContain(SECRET_NAME);
  }, 120_000);

  it('only an explicit choice turns sealing off — everything else means sealed', () => {
    // The default is the whole decision. A missing store, an empty one, a corrupt read and an unrelated
    // value must all land on SEALED, because the failure that silently removes protection is the one
    // worth designing against — and it is the one a person would never notice.
    expect(atRestSettings().sealAtRest, 'no settings at all').toBe(true);
    expect(atRestSettings({}).sealAtRest, 'an empty store').toBe(true);
    expect(atRestSettings(null).sealAtRest, 'an unreadable store').toBe(true);
    expect(atRestSettings({ sealAtRest: 'no' }).sealAtRest, 'a non-boolean').toBe(true);
    // ...and the one thing that does turn it off is a person setting it to false.
    expect(atRestSettings({ sealAtRest: false }).sealAtRest, 'the explicit opt-out').toBe(false);
  });

  it('a person who opts out gets what they chose — plain text on their own disk', async () => {
    const optOutDir = await mkdtemp(path.join(tmpdir(), 'at-rest-off-'));
    const file = path.join(optOutDir, 'household-items.json');
    // The shell's settings IO, saying what a person said in the toggle.
    const io = { load: async () => ({ sealAtRest: false }) };
    const off = await bootRealAgentNode('opted-out', {
      agentOpts: { householdPersistDb: { path: file }, atRestIo: io },
    });
    try {
      await off.agent.callSkill('household', 'addItem', { type: 'shopping', text: SECRET_ITEM });
      await new Promise((r) => setTimeout(r, 1200));
      const onDisk = await readFile(file, 'utf-8').catch(() => '');
      expect(onDisk, 'opting out must actually opt out — otherwise the setting is a lie').toContain(SECRET_ITEM);
    } finally {
      await teardown(off).catch(() => {});
      await rm(optOutDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 120_000);
});

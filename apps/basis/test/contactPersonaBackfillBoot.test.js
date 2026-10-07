/**
 * The persona backfill, through the real boot: a contact row that predates the persona field gets `default`
 * written onto it when the agent starts — where its pair circle id proves it.
 *
 * The backfill reads the rows the agent's own contact book holds. Those rows are keyed by `webid` (the book's
 * key; `contactId` is the Contacten projection's word for the same value), so a backfill that looked for any
 * other key skipped every row and wrote nothing on a real device, while its unit tests — handed rows in the
 * projection's shape — stayed green. This boots the agent the way the box does, twice over one data dir: the
 * first boot writes a contact row WITHOUT a persona (the shape the pair roster writes: webid + pairCircleId),
 * the second boot is the start that has to backfill it.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { bookRowsOf } from '../src/v2/contactsSource.js';
import { pairCircleIdFor } from '../src/v2/pairCircleId.js';
import { DEFAULT_PERSONA, personaOfContact } from '../src/v2/contactPersona.js';

const THEM = 'webid-of-someone-added-before-personas';

describe('the persona backfill at boot', () => {
  let dir;
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('writes `default` onto a contact row that predates the field, when its pair circle proves it', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'persona-backfill-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    const boot = () => createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass),
      chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      stoopPersistDb: { path: path.join(dir, 'stoop-state.json') },
      seedDemoData: false, seedHousehold: false,
    });
    const rowOf = async (agent) => bookRowsOf(await agent.callSkill('stoop', 'listContacts', {})).find((c) => c?.webid === THEM) ?? null;

    // First boot: the row as a pre-persona device holds it — the pair roster's own write, no persona.
    const first = await boot();
    const self = first.meta.chatAddress;
    const pairCircleId = pairCircleIdFor(self, THEM);
    const added = await first.callSkill('stoop', 'addContact', { webid: THEM, pairCircleId });
    expect(added?.contact, JSON.stringify(added)).toBeTruthy();
    const before = await rowOf(first);
    expect(before, 'the seeded row is in the book').toMatchObject({ webid: THEM, pairCircleId });
    expect(personaOfContact(before), 'the seeded row records no persona — the shape the backfill exists for').toBeNull();
    await new Promise((r) => setTimeout(r, 1200));   // let the book reach disk
    await first.stop?.().catch(() => {});

    // Second boot: the start that must backfill it. The backfill runs after boot, best-effort — wait for it.
    const second = await boot();
    expect(second.meta.chatAddress, 'the same identity came back').toBe(self);
    let row = null;
    for (let i = 0; i < 40; i += 1) {
      row = await rowOf(second);
      if (personaOfContact(row)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await second.stop?.().catch(() => {});
    expect(row, 'the row survived the restart').toBeTruthy();
    expect(row.pairCircleId, 'the row still carries the pair circle that proves it').toBe(pairCircleId);
    expect(row.persona, 'the boot backfill wrote the default persona onto the pre-persona row').toBe(DEFAULT_PERSONA);
    expect(row.personaAt, 'written as the backfill (any real choice outranks it)').toBe(0);
  }, 120_000);
});

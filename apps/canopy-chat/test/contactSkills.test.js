/**
 * canopy-chat — contact-skill → manifest bridge tests (P4 synthesis,
 * feedback-extension Mode-1 "bot-exposed skills").
 *
 * Covers DESIGN §1.2 (the SCOPED CATALOG: a remote-skill entry is
 * contact-thread-scoped, dispatched to that bot) + §2.2 (P4), for the PURE
 * synthesis + routing core (NOT the live PeerGraph/ChatScreen wiring):
 *   - SkillCards → a manifest whose ops carry `binding:'remote-skill@contact'`
 *     + `bindRef` + a `/`-slash surface, and that passes `validateManifest`;
 *   - merging that manifest via `mergeManifests` lands the ops in `opsById`;
 *   - `verifyMapping` (the catalog gate) treats these ops as ok (remote
 *     bindings skip the gate — the bot vouches);
 *   - `makeRemoteCallSkill` routes a dispatch to the injected `sendA2ATask`
 *     with the right `(peerUrl, skillId, args)`;
 *   - `contactSkillSources` tags the source with scope + contactId.
 */
import { describe, it, expect, vi } from 'vitest';

import { validateManifest } from '@canopy/app-manifest';

import {
  skillCardsToManifest,
  skillCardToOp,
  contactSkillSources,
  makeRemoteCallSkill,
  contactManifestApp,
  REMOTE_SKILL_BINDING,
  CONTACT_THREAD_SCOPE,
} from '../src/v2/contactSkills.js';
import { mergeManifests } from '../src/manifestMerge.js';
import { verifyMapping } from '../src/mappings.js';

const CONTACT = 'did:web:bot.example';
const CARDS = [
  { id: 'summarise', description: 'Summarise a thread', tags: ['text'] },
  { id: 'translate', description: 'Translate text',     tags: ['text', 'i18n'] },
];

describe('skillCardsToManifest', () => {
  it('synthesises one op per card with the remote-skill binding shape', () => {
    const m = skillCardsToManifest(CONTACT, CARDS);

    expect(m.app).toBe(contactManifestApp(CONTACT));
    expect(m.itemTypes).toEqual([]);
    expect(m.operations).toHaveLength(2);

    const op = m.operations[0];
    expect(op.id).toBe('summarise');
    expect(op.verb).toBe('submit');
    expect(op.binding).toBe(REMOTE_SKILL_BINDING);
    expect(op.bindRef).toEqual({ contactId: CONTACT, skillId: 'summarise' });
    expect(op.scope).toBe(CONTACT_THREAD_SCOPE);
    expect(op.surfaces.slash.command).toBe('/summarise');
  });

  it('drops cards without a usable id', () => {
    const m = skillCardsToManifest(CONTACT, [
      { id: 'ok' },
      { id: '' },
      { description: 'no id' },
      null,
    ]);
    expect(m.operations.map((o) => o.id)).toEqual(['ok']);
  });

  it('passes validateManifest so it can be merged', () => {
    const m = skillCardsToManifest(CONTACT, CARDS);
    const { ok, errors } = validateManifest(m);
    expect(errors).toEqual([]);
    expect(ok).toBe(true);
  });
});

describe('skillCardToOp', () => {
  it('keeps skillId === opId by construction', () => {
    const op = skillCardToOp(CONTACT, { id: 'classify' });
    expect(op.id).toBe('classify');
    expect(op.bindRef.skillId).toBe('classify');
  });
});

describe('mergeManifests over a contact manifest', () => {
  it('lands the remote-skill ops in opsById', () => {
    const m = skillCardsToManifest(CONTACT, CARDS);
    const catalog = mergeManifests([{ manifest: m }]);

    expect(catalog.opsById.has('summarise')).toBe(true);
    expect(catalog.opsById.has('translate')).toBe(true);

    const entry = catalog.opsById.get('summarise');
    expect(entry.appOrigin).toBe(contactManifestApp(CONTACT));
    expect(entry.op.binding).toBe(REMOTE_SKILL_BINDING);
    expect(entry.op.bindRef.skillId).toBe('summarise');

    // The `/`-slash surface rides through into the command menu.
    const cmd = catalog.commandMenu.find((c) => c.command === '/summarise');
    expect(cmd).toBeTruthy();
    expect(cmd.opId).toBe('summarise');
  });
});

describe('verifyMapping treats remote-skill ops as ok (catalog gate skip)', () => {
  it('does not require the bot skill to resolve in the catalog', () => {
    // Shape the synthesised ops as a `mapping` (ops[]) — verifyMapping reads
    // `mapping.ops` and skips remote bindings (the bot vouches, not the catalog).
    const { operations } = skillCardsToManifest(CONTACT, CARDS);
    const mapping = { id: contactManifestApp(CONTACT), ops: operations };

    // An EMPTY catalog: a composite op would fail to resolve, but a remote op
    // must still pass because it's skipped.
    const emptyCatalog = { opsById: new Map() };
    const { ok, missing } = verifyMapping(mapping, emptyCatalog);

    expect(ok).toBe(true);
    expect(missing).toEqual([]);
  });
});

describe('contactSkillSources', () => {
  it('wraps the manifest as a scope-tagged mergeManifests source', () => {
    const sources = contactSkillSources(CONTACT, CARDS);
    expect(sources).toHaveLength(1);

    const [src] = sources;
    expect(src.scope).toBe(CONTACT_THREAD_SCOPE);
    expect(src.contactId).toBe(CONTACT);
    expect(src.manifest.app).toBe(contactManifestApp(CONTACT));

    // The tagged source still merges (mergeManifests ignores the extra keys).
    const catalog = mergeManifests(sources);
    expect(catalog.opsById.has('summarise')).toBe(true);
  });

  it('returns [] when there are no usable cards', () => {
    expect(contactSkillSources(CONTACT, [])).toEqual([]);
    expect(contactSkillSources(CONTACT, [{ id: '' }])).toEqual([]);
  });
});

describe('makeRemoteCallSkill', () => {
  it('routes a remote-skill dispatch to sendA2ATask with (peerUrl, skillId, args)', () => {
    const sendA2ATask  = vi.fn(() => 'task-handle');
    const resolvePeerUrl = vi.fn((id) => `https://peer/${id}`);

    const callSkill = makeRemoteCallSkill({
      contactId: CONTACT,
      resolvePeerUrl,
      sendA2ATask,
      skillCards: CARDS,
    });

    const args = { text: 'hello' };
    const out = callSkill(contactManifestApp(CONTACT), 'translate', args);

    expect(resolvePeerUrl).toHaveBeenCalledWith(CONTACT);
    expect(sendA2ATask).toHaveBeenCalledTimes(1);
    expect(sendA2ATask).toHaveBeenCalledWith(`https://peer/${CONTACT}`, 'translate', args);
    expect(out).toBe('task-handle');
  });

  it('falls through (undefined) for an op that is not one of this contact\'s skills', () => {
    const sendA2ATask = vi.fn();
    const callSkill = makeRemoteCallSkill({
      contactId: CONTACT,
      resolvePeerUrl: () => 'https://peer',
      sendA2ATask,
      skillCards: CARDS,
    });

    const out = callSkill('some-app', 'unknownOp', {});
    expect(out).toBeUndefined();
    expect(sendA2ATask).not.toHaveBeenCalled();
  });

  it('accepts an explicit opsResolver Map (e.g. the merged catalog)', () => {
    const sendA2ATask = vi.fn(() => 'ok');
    const op = skillCardToOp(CONTACT, { id: 'summarise' });
    const opsResolver = new Map([['summarise', op]]);

    const callSkill = makeRemoteCallSkill({
      contactId: CONTACT,
      resolvePeerUrl: () => 'https://peer',
      sendA2ATask,
      opsResolver,
    });

    callSkill('x', 'summarise', { n: 1 });
    expect(sendA2ATask).toHaveBeenCalledWith('https://peer', 'summarise', { n: 1 });
  });

  it('defaults args to {} when omitted', () => {
    const sendA2ATask = vi.fn();
    const callSkill = makeRemoteCallSkill({
      contactId: CONTACT,
      resolvePeerUrl: () => 'https://peer',
      sendA2ATask,
      skillCards: CARDS,
    });

    callSkill('x', 'summarise');
    expect(sendA2ATask).toHaveBeenCalledWith('https://peer', 'summarise', {});
  });
});

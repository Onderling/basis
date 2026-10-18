/**
 * THIS DEVICE'S SELVES, TYPED: `/hier` lists them, `/pauze <naam>` and `/hervat <naam>` run the SAME device ops the
 * "Persona's op dit apparaat" buttons run, by NAME — the name resolves over this device's own list, and two selves with
 * one name are a question, never a guess. The reply is the screen's own words. A device op is on no bot's door: a member
 * typing `/pauze …` to the household bot reaches nothing.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../../src/web/realAgent.js';
import { mergeManifests } from '../../src/manifestMerge.js';
import { householdManifest } from '../../../household/manifest.js';
import { parseInput } from '../../src/parser.js';
import { clarifyCommandTargets } from '../../src/v2/clarifyTargets.js';
import { makeCircleLookup } from '../../src/v2/circleLookup.js';
import { circleReplyText } from '../../src/v2/circleReply.js';
import { scopeCatalogueToRole } from '../../src/v2/botOpMap.js';
import { botDoorChecks } from '../../src/v2/botRungs.js';
import nl from '../../src/locales/circle.nl.json' with { type: 'json' };

const catalogue = mergeManifests([{ manifest: householdManifest }]);
// the real Dutch words, so the reply is read as a person reads it
const t = (key, vars = {}) => {
  const node = String(key).replace(/^circle\./, '').split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), nl);
  const text = typeof node === 'string' ? node : (node && typeof node.text === 'string' ? node.text : key);
  return text.replace(/\{\{(\w+)\}\}/g, (_, v) => (vars[v] != null ? String(vars[v]) : ''));
};

/** The composer's path for one typed line: parse → resolve the name over this device's list → the op → its reply. */
async function typed(agent, line) {
  const parsed = parseInput(line, catalogue);
  expect(parsed?.kind, `${line} parses as a slash command`).toBe('slash');
  const lookup = makeCircleLookup({ appCallSkill: (app, op, args) => agent.callSkill(app, op, args), scopeId: () => null });
  const r = await clarifyCommandTargets({ opId: parsed.opId, args: parsed.args ?? {}, appOrigin: parsed.appOrigin }, { catalogue, lookup, scope: {} });
  if (r.kind !== 'ready') return { route: r };
  const reply = await agent.callSkill(r.appOrigin ?? 'household', r.opId, r.args);
  return { route: r, reply, text: circleReplyText({ opId: r.opId, payload: reply }, { verb: catalogue.opsById.get(r.opId)?.op?.verb, t }) };
}

describe('the persona slash commands', () => {
  it('/pauze Werk runs the device op for Werk — by name — and answers in the screen\'s words; /hervat undoes it', async () => {
    const a = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const w = (await a.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const p = await typed(a, '/pauze Werk');
    expect(p.route, 'the name resolved to the id').toMatchObject({ kind: 'ready', opId: 'pausePersona', args: { personaId: w } });
    expect(p.reply).toMatchObject({ ok: true, reloadRequired: true, personaId: w, name: 'Werk' });
    expect(p.text).toBe(t('circle.receive_personas.done_pause_reload', { name: 'Werk' }));
    expect((await a.callSkill('household', 'listPersonasHere', {})).personas.find((x) => x.id === w)?.paused).toBe(true);
    const h = await typed(a, '/hier');
    expect(h.text.split('\n'), '/hier: each self with its state').toEqual([
      `• ${t('circle.switcher.you')} — ${t('circle.receive_personas.primary')}`,
      `• Werk — ${t('circle.receive_personas.paused')}`,
    ]);
    const r = await typed(a, '/hervat Werk');
    expect(r.reply).toMatchObject({ ok: true, personaId: w });
    expect(r.text).toBe(t('circle.receive_personas.done_resume_reload', { name: 'Werk' }));
    await a.shutdown?.();
  });

  it('two selves with one name: the question, never a guess; an unknown name: nothing runs', async () => {
    const a = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const w1 = (await a.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const w2 = (await a.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const amb = await typed(a, '/pauze Werk');
    expect(amb.route.kind, JSON.stringify(amb.route)).toBe('clarify');
    expect(amb.route.candidates.map((c) => c.id).sort()).toEqual([w1, w2].sort());
    const none = await typed(a, '/pauze Thuis');
    expect(none.route.kind).not.toBe('ready');
    const here = (await a.callSkill('household', 'listPersonasHere', {})).personas;
    expect(here.filter((x) => x.paused), 'nothing was paused').toEqual([]);
    await a.shutdown?.();
  });

  it('a device op is on no bot\'s door: not in any role\'s menu or catalogue, refused at the door\'s map', async () => {
    for (const role of ['admin', 'member', 'observer', null]) {
      const scoped = scopeCatalogueToRole(catalogue, role);
      for (const id of ['listPersonasHere', 'pausePersona', 'resumePersona']) expect(scoped.opsById.has(id), `${role}: ${id}`).toBe(false);
      for (const cmd of ['/hier', '/pauze', '/hervat']) expect((scoped.commandMenu ?? []).some((e) => e.command === cmd), `${role}: ${cmd}`).toBe(false);
    }
    const [, doorMap] = botDoorChecks({ checkCaller: async () => {}, opLevel: () => null, isDeclared: () => true });
    expect(await doorMap({ opId: 'household.pausePersona', caller: 'bob' })).toMatchObject({ layer: 'door-map' });
  });
});

/**
 * One owner per skill among the in-process agents: today's collisions are a baseline that only SHRINKS.
 *
 * The in-process agents (host, tasks, pinboard; household and folio register on the host) register skills by name; when two register the same
 * id, which one a call reaches is decided by registration order, and folding the agents into one would overwrite one
 * silently. The collisions are removed one owner at a time, and none may be added meanwhile. (The manifest-level rule
 * is scripts/lint-op-owners.mjs; this covers the runtime registrations, which include ops no manifest declares.)
 */
import { describe, it, expect } from 'vitest';
import { createRealHouseholdAgent } from '../../src/web/realAgent.js';

/** The skill ids two or more in-process agents register today, with their owners. Only ever remove from this. */
const BASELINE = {
  addTask: ['host', 'tasks'],
  listOpen: ['host', 'tasks', 'pinboard'],
  completePodSignIn: ['tasks', 'pinboard'],
  getChatThread: ['tasks', 'pinboard'],
  getCircleStoragePolicy: ['tasks', 'pinboard'],
  getItemTree: ['tasks', 'pinboard'],
  getMetrics: ['tasks', 'pinboard'],
  getPrivacyNotice: ['tasks', 'pinboard'],
  listChatThreads: ['tasks', 'pinboard'],
  podSignInStatus: ['tasks', 'pinboard'],
  resolveMember: ['tasks', 'pinboard'],
  sendChatMessage: ['tasks', 'pinboard'],
  setCircleStoragePolicy: ['tasks', 'pinboard'],
  signOutOfPod: ['tasks', 'pinboard'],
  startPodSignIn: ['tasks', 'pinboard'],
};

describe('in-process skill owners', () => {
  it('no new skill id is registered by two in-process agents, and the baseline shrinks with the code', { timeout: 120_000 }, async () => {
    const agent = await createRealHouseholdAgent({ seedHousehold: false });
    const owners = {};
    for (const [name, ids] of Object.entries(agent.inProcessSkillIds())) {
      expect(ids.length, `${name} registers no skills — the accessor no longer reaches it`).toBeGreaterThan(0);
      for (const id of ids) (owners[id] ??= []).push(name);
    }
    const shared = Object.fromEntries(Object.entries(owners).filter(([, v]) => v.length > 1));
    const sorted = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v].sort()]).sort(([a], [b]) => a.localeCompare(b)));
    expect(sorted(shared), 'a skill id gained an owner (red) or lost one (shrink BASELINE)').toEqual(sorted(BASELINE));
  });
});

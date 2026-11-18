/**
 * A FENCE on what the person's own model is handed in the "+": ordinary acts only. No op that is an admin's or the
 * device's (group `admin`/`device`, or a write scoped to the device), none a peer must be trusted for (visibility
 * `private`/`trusted`), none that declares a confirmation, unless it is named here with its reason. Which acts are
 * ordinary and which admin-like is a design after the alpha; until then nothing of that kind reaches the model unnamed.
 */
import { describe, it, expect } from 'vitest';
import { ownPlaceCatalogue } from '../../src/assistant/plusDoor.js';
import { catalogueManifests } from '../../src/v2/manifestSources.js';

/** Admin-like by its declaration: why, or null. */
export function adminLike(op) {
  if (op?.group === 'admin' || op?.group === 'device') return `group ${op.group}`;
  if (op?.writes?.scope === 'device') return 'writes the device';
  if (op?.visibility === 'private' || op?.visibility === 'trusted') return `visibility ${op.visibility}`;
  if (op?.confirm || op?.surfaces?.ui?.confirm) return 'declares a confirmation';
  return null;
}

/** Handed to the model all the same, each with its reason. */
const NAMED = {
  'assistant.assistant-memory': "the door's own op: how much of THIS conversation is kept (the person's own thread)",
  'assistant.assistant-language': "the door's own op: the language THIS conversation is answered in",
  'calendar.cancelEvent': 'declares a confirmation; from the model it is only ever a card the person answers (that is the confirmation)',
  'lists.removeList': 'declares a confirmation; from the model it is only ever a card the person answers (that is the confirmation)',
};

describe('the "+" model is handed ordinary acts only', () => {
  it('nothing admin-like reaches the model unnamed', () => {
    const { catalogue } = ownPlaceCatalogue({});
    const offered = [...catalogue.opsById.values()].filter((e) => e.op.surfaces?.chat);
    const caught = offered.filter((e) => adminLike(e.op)).map((e) => `${e.appOrigin}.${e.op.id}`);
    expect(caught.filter((id) => !NAMED[id])).toEqual([]);
    // what it catches today, every one named: the conversation's two settings and two removals that ask first
    expect(caught.sort()).toEqual(Object.keys(NAMED).sort());
  });
  it('the fence bites: an admin op with a confirmation would be caught', () => {
    const agents = catalogueManifests().find((m) => m.app === 'agents');
    const grant = agents.operations.find((o) => o.id === 'grantAgent');
    expect(adminLike(grant)).toBeTruthy();
  });
});

/**
 * Ops a model must not reach on its own lose their chat hint (Fable's prune rulings, ledger L1025, step C; the record
 * is plans/notes/NOTE-unreached-ops-2026-11-18.md): plumbing a person never asks for, a picker's feed, and task flows
 * that lost their screen (named on L442). The ops stay; only the model's tool list loses them, and their Dutch hints go.
 */
import { describe, it, expect } from 'vitest';
import { buildToolDescriptors } from '../../src/v2/interpretCommand.js';
import { mergeManifests } from '../../src/manifestMerge.js';
import { allManifests } from '../../src/v2/manifestSources.js';
import hintsNl from '../../src/locales/chat-hints.nl.json' with { type: 'json' };

const DROPPED = [
  ['folio', 'watchStop'], ['pinboard', 'broadcastCircleRules'], ['pinboard', 'getLatestPostAddedAt'],
  ['pinboard', 'listCirclePostsSince'], ['pinboard', 'listConsentingPeers'], ['pinboard', 'listOfferingCategories'],
  ['agents', 'listDataVersions'], ['agents', 'grantRole'], ['tasks', 'revokeTask'], ['tasks', 'getDagTree'],
  ['tasks', 'listMyMasteredTasks'], ['tasks', 'listClaimConflicts'], ['tasks', 'clearInbox'], ['tasks', 'clearInboxItem'],
];

describe('the model\'s tool list leaves out what a model must not reach alone', () => {
  const manifests = allManifests();
  // the apps these ops belong to (a merge of every manifest refuses governance's verb-less ops)
  const apps = new Set(DROPPED.map(([app]) => app));
  const tools = buildToolDescriptors(mergeManifests(manifests.filter((m) => apps.has(m.app)).map((manifest) => ({ manifest }))));
  for (const [app, op] of DROPPED) {
    it(`${app}.${op}: still an op, no chat hint, not a tool, no Dutch hint`, () => {
      const decl = manifests.find((m) => m.app === app)?.operations?.find((o) => o.id === op);
      expect(decl, 'the op stays').toBeTruthy();
      expect(decl.surfaces?.chat ?? null).toBeNull();
      expect(tools.some((t) => t.id === op || t.id?.endsWith(`/${op}`))).toBe(false);
      expect(hintsNl?.[app]?.[op] ?? null).toBeNull();
    });
  }
  it('the rules fan is background: never a person\'s act (no strip, no record)', () => {
    const decl = manifests.find((m) => m.app === 'pinboard').operations.find((o) => o.id === 'broadcastCircleRules');
    expect(decl.surfaces?.actState).toBe('none');
  });
});

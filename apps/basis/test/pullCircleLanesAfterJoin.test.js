/**
 * After a join, a device pulls the circle's lanes from the members it now knows — ALL of them. Every shell pulled only
 * membership · governance · keys there, so the circle's CONTENT (lists, chores, appointments on the task lane; the
 * conversation on the chat lane) reached a fresh joiner only at its next boot: someone who joined the household from
 * a running app saw an empty household. One shared pull, every shell through it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pullCircleLanes, JOIN_PULL_LANES } from '../src/v2/circleLanes.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('the pull after a join', () => {
  it('asks every lane for the one circle — the content lanes too', async () => {
    const asked = [];
    const lane = (k) => ({ requestCircle: async (cid) => { asked.push(`${k}:${cid}`); return { requested: 1 }; } });
    const catchUps = Object.fromEntries(['membership', 'gov', 'key', 'task', 'chat', 'podChat'].map((k) => [k, lane(k)]));
    await pullCircleLanes(catchUps, 'c1', { callSkill: async () => null });
    expect(asked.sort()).toEqual(['chat:c1', 'gov:c1', 'key:c1', 'membership:c1', 'task:c1']);
    expect(JOIN_PULL_LANES).toEqual(expect.arrayContaining(['task', 'chat']));
    // a lane a device does not have, or one that fails, does not stop the others
    const r = await pullCircleLanes({ task: { requestCircle: async () => { throw new Error('down'); } }, chat: lane('chat') }, 'c2', { callSkill: async () => null });
    expect(r.map((x) => x.status)).toContain('rejected');
  });

  it('FITNESS: every shell\'s post-join pull is the shared one, never a list of its own', () => {
    for (const f of ['basis/web/v2/circleApp.js', 'basis/bin/device-runner.mjs', 'basis-mobile/src/core/agentBundle.js']) {
      const src = readFileSync(path.join(root, f), 'utf8');
      const pulls = [...src.matchAll(/pullLanes:\s*\(cid\)\s*=>\s*([^\n]+)/g)].map((m) => m[1]);
      expect(pulls.length, `${f} has a post-join pull`).toBeGreaterThan(0);
      for (const p of pulls) expect(p, f).toMatch(/^pullCircleLanes\(/);
    }
  });
});

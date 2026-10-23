/**
 * household web UI smoke — (PLAN-gui-chat-uplift.md).
 *
 * Boots the household-web bootstrap programmatically, then verifies:
 *   1. Every static asset (`/`, `/main.js`, `/style.css`) is served + non-empty.
 *   2. `/navmodel.json` carries the 6 declared sections (4 list types + tasks + members).
 *   3. `/household-config.json` carries the actor.
 *   4. The agent card is reachable.
 *   5. The skill-dispatch path round-trips: `addItem({type:'shopping', text:'bread'})`
 *      then `listOpen({type:'shopping'})` returns the freshly-added item.
 *
 * Pattern mirrors apps/tasks-v0/test/web.test.js — same `/tasks/send`
 * shape, same LocalUiAuth-configured actor.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { startHouseholdWeb } from '../bin/household-web.js';

const ACTOR = 'https://id.example/anne';

let handle, baseUrl;

beforeAll(async () => {
  handle  = await startHouseholdWeb({ port: 0, actor: ACTOR });
  baseUrl = handle.url;
});

afterAll(async () => {
  await handle?.stop();
});

describe('household web UI smoke (Slice A.3)', () => {
  it('serves index.html on /', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('Household');
    expect(html).toContain('add-form');
    expect(html).toContain('id="tabs"');
    // chat passthrough surface.
    expect(html).toContain('chat-form');
    expect(html).toContain('chat-input');
  });

  it('serves /main.js', async () => {
    const res = await fetch(`${baseUrl}/main.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    const js = await res.text();
    expect(js.length).toBeGreaterThan(0);
    expect(js).toContain('callSkill');
    expect(js).toContain('/navmodel.json');
  });

  // .0 — main.js imports the shared web-adapter helpers
  // from the `/lib/web-adapter/*.js` overlay (the same mechanism
  // tasks-ui.js uses for `/lib/dagFlatten.js`). Smoke-check that the
  // overlay endpoints serve each helper file with ESM `export`.
  it('serves /lib/web-adapter/* overlays (B.2.0 shared helpers)', async () => {
    const names = [
      'callSkill', 'deriveItemState', 'itemMatchesAppliesTo',
      'applyPrefilledParams', 'index',
    ];
    for (const n of names) {
      const res = await fetch(`${baseUrl}/lib/web-adapter/${n}.js`);
      expect(res.status, `expected 200 for ${n}.js`).toBe(200);
      const js = await res.text();
      expect(js).toContain('export');
    }
  });

  it('serves /style.css', async () => {
    const res = await fetch(`${baseUrl}/style.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/css/);
    const css = await res.text();
    expect(css.length).toBeGreaterThan(0);
  });

  it('exposes the agent card', async () => {
    const res = await fetch(`${baseUrl}/.well-known/agent.json`);
    expect(res.status).toBe(200);
    const card = await res.json();
    expect(card).toHaveProperty('skills');
  });

  it('serves /navmodel.json with the 6 declared sections', async () => {
    const res = await fetch(`${baseUrl}/navmodel.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const nav = await res.json();
    expect(nav.app).toBe('household');
    expect(nav.sections.map((s) => s.id)).toEqual([
      'shopping', 'errand', 'repair', 'schedule', 'tasks', 'members',
    ]);
    // Spot-check prefilledParams plumbing — shopping section's
    // addItem affordance must carry { type: 'shopping' } so the web
    // client dispatches addItem({type: 'shopping', text}) on submit.
    const shopping  = nav.sections.find((s) => s.id === 'shopping');
    const addItem   = shopping.affordances.find((a) => a.opId === 'addItem');
    expect(addItem.prefilledParams).toEqual({ type: 'shopping' });
  });

  it('serves /household-config.json with the actor', async () => {
    const res = await fetch(`${baseUrl}/household-config.json`);
    expect(res.status).toBe(200);
    const cfg = await res.json();
    expect(cfg.actor).toBe(ACTOR);
    expect(cfg.app).toBe('household');
  });

  it('addItem → listOpen round-trips through the LocalUiAuth dispatch path', async () => {
    // Add a shopping item via the same wire shape the client uses.
    const addBody = {
      skillId: 'addItem',
      message: { parts: [{ type: 'DataPart', data: { type: 'shopping', text: 'bread' } }] },
    };
    const addRes = await fetch(`${baseUrl}/tasks/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(addBody),
    });
    expect(addRes.status).toBe(200);
    const addJson = await addRes.json();
    expect(addJson.status).toBe('completed');

    // Now fetch the list — must include the freshly added bread.
    const listBody = {
      skillId: 'listOpenItems',
      message: { parts: [{ type: 'DataPart', data: { type: 'shopping' } }] },
    };
    const listRes = await fetch(`${baseUrl}/tasks/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(listBody),
    });
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    expect(listJson.status).toBe('completed');
    const dp = (listJson.artifacts?.[0]?.parts ?? []).find((p) => p?.type === 'DataPart');
    expect(dp).toBeTruthy();
    expect(Array.isArray(dp.data.items)).toBe(true);
    expect(dp.data.items.some((it) => it.text === 'bread' && it.type === 'shopping')).toBe(true);
  });

  it('markComplete via the dispatch path closes an open item', async () => {
    // Seed an item.
    await fetch(`${baseUrl}/tasks/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        skillId: 'addItem',
        message: { parts: [{ type: 'DataPart', data: { type: 'errand', text: 'pick up parcel' } }] },
      }),
    });
    // Find its id via listOpen.
    const listRes = await fetch(`${baseUrl}/tasks/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        skillId: 'listOpenItems',
        message: { parts: [{ type: 'DataPart', data: { type: 'errand' } }] },
      }),
    });
    const listJson = await listRes.json();
    const listDp   = (listJson.artifacts?.[0]?.parts ?? []).find((p) => p?.type === 'DataPart');
    const parcel   = listDp.data.items.find((it) => it.text === 'pick up parcel');
    expect(parcel).toBeTruthy();

    // markComplete by id.
    const doneRes = await fetch(`${baseUrl}/tasks/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        skillId: 'markComplete',
        message: { parts: [{ type: 'DataPart', data: { match: parcel.id } }] },
      }),
    });
    expect(doneRes.status).toBe(200);

    // Re-list — parcel should be gone (listOpen filters to open items).
    const list2 = await fetch(`${baseUrl}/tasks/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        skillId: 'listOpenItems',
        message: { parts: [{ type: 'DataPart', data: { type: 'errand' } }] },
      }),
    });
    const list2Json = await list2.json();
    const list2Dp   = (list2Json.artifacts?.[0]?.parts ?? []).find((p) => p?.type === 'DataPart');
    expect(list2Dp.data.items.some((it) => it.id === parcel.id)).toBe(false);
  });
});

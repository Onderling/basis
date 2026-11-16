/**
 * The "+" says plainly what it can do without a model, and which model answers when there is one:
 *   - no own model set, and the plain reading did not take the line: it says no model is set, what works without one,
 *     and the way to the setting, in the screens' own labels (one shared source);
 *   - the own model could not be reached: it says so (never "I could not read that");
 *   - the line at the top of the conversation names the route that answers and whether it is confidential: only a
 *     confidential route the guard accepts is called confidential.
 */
import { describe, it, expect } from 'vitest';
import { createPlusDoor, plusRouteLine, plusNoModelAnswer } from '../../src/assistant/plusDoor.js';
import { ownRouteOf } from '../../src/v2/userLlmRuntime.js';
import { EventLog } from '../../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../../src/v2/botThreads.js';
import nl from '../../src/locales/circle.nl.json';
import en from '../../src/locales/circle.en.json';

const t = (k, v) => `${k}${v ? ` ${JSON.stringify(v)}` : ''}`;
const threads = () => createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
const get = (bundle, key) => key.replace(/^circle\./, '').split('.').reduce((o, p) => o?.[p], bundle);
const textOf = (bundle, key) => { const v = get(bundle, key); return typeof v === 'string' ? v : v?.text; };

describe('no own model', () => {
  it('a line the plain reading did not take gets: no model is set, what works, and the way to the setting', async () => {
    const d = createPlusDoor({ t, threads: threads(), threadId: 'own:me' });
    const r = await d.read('wat kan je allemaal?');
    expect(r.done).toContain('circle.vandaag.plus_no_model');
    for (const k of ['circle.tab.mij', 'circle.settings_home.title', 'circle.settings_home.appearance', 'circle.userLlm.title']) expect(r.done).toContain(k);
    expect(r.error ?? null).toBe(null);
  });
  it('the way to the setting is in both languages, from the screens\' own labels', () => {
    for (const bundle of [nl, en]) {
      for (const k of ['circle.vandaag.plus_no_model', 'circle.vandaag.plus_model_unreachable', 'circle.vandaag.plus_route_none',
        'circle.vandaag.plus_route_confidential', 'circle.vandaag.plus_route_plain',
        'circle.tab.mij', 'circle.settings_home.title', 'circle.settings_home.appearance', 'circle.userLlm.title']) {
        expect(textOf(bundle, k), k).toBeTruthy();
      }
    }
    expect(plusNoModelAnswer({ t: (k, v) => { const s = textOf(nl, k); return v ? s.replace(/{{(\w+)}}/g, (_, n) => v[n]) : s; } })).toContain('Assistent-endpoint');
  });
});

it('the own model could not be reached: it says so, not "could not read"', async () => {
  const d = createPlusDoor({ t, threads: threads(), threadId: 'own:me', llm: { invoke: async () => null },
    interpret: async () => { throw Object.assign(new Error('unreachable'), { code: 'ECONNREFUSED' }); } });
  const r = await d.read('wat kan je allemaal?');
  expect(JSON.stringify(r)).toContain('circle.vandaag.plus_model_unreachable');
  expect(JSON.stringify(r)).not.toContain('plus_line_unread');
});

describe('the route line at the top of the conversation', () => {
  it('none set; a confidential route the guard accepts; a plain route named by its host', () => {
    expect(plusRouteLine(ownRouteOf(null), { t })).toContain('plus_route_none');
    expect(plusRouteLine(ownRouteOf({ preset: 'local-ollama', llmBaseUrl: 'http://127.0.0.1:11434' }), { t })).toMatch(/plus_route_plain.*127\.0\.0\.1/);
    expect(plusRouteLine(ownRouteOf({ preset: 'confidential-proxy', llmBaseUrl: 'http://127.0.0.1:8080' }), { t })).toContain('plus_route_confidential');
  });
  it('a "confidential" preset the guard refuses is never called confidential', () => {
    const r = ownRouteOf({ preset: 'confidential-proxy', llmBaseUrl: 'https://example.org' });
    expect(plusRouteLine(r, { t })).not.toContain('plus_route_confidential');
  });
});

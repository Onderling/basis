/**
 * Self-test for lint-chat-hints-localised: red on a missing hint, on a hint not in the `{text, doc}` shape, and on an
 * ALLOW entry that has its hint (the list only shrinks); green on the real tree.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditHints } from './lint-chat-hints-localised.mjs';
import { hintMessages } from './lint-chat-hints-localised.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const m = { app: 'lists', operations: [{ id: 'createList', surfaces: { chat: { hint: 'Start a list.' } } }, { id: 'silent', surfaces: {} }] };

describe('lint-chat-hints-localised', () => {
  it('a chat op without its Dutch hint is red; an op without a chat surface is not asked', () => {
    expect(auditHints([m], {}, new Set()).missing).toEqual(['lists:createList']);
  });
  it('a hint that is a bare string is the wrong shape', () => {
    expect(auditHints([m], { lists: { createList: 'Begin een lijst.' } }, new Set()).badShape).toEqual(['lists:createList']);
  });
  it('an allowed op that has its hint is stale: the list only shrinks', () => {
    const nl = { lists: { createList: { text: 'Begin een lijst.', doc: 'd' } } };
    expect(auditHints([m], nl, new Set(['lists:createList'])).stale).toEqual(['lists:createList']);
    expect(auditHints([m], nl, new Set())).toEqual({ missing: [], badShape: [], stale: [] });
  });
  it('is green on the current tree', () => {
    const r = spawnSync(process.execPath, [path.join(HERE, 'lint-chat-hints-localised.mjs')], { encoding: 'utf8' });
    expect(r.stdout + r.stderr).toMatch(/Dutch hint/);
    expect(r.status).toBe(0);
  });
});

describe('chat-hints red lines say where and what to do instead', () => {
  it('a bad shape names its json line, a stale allowance its guard line, and each kind has a Fix', () => {
    const nlText = '{\n  "tasks": {\n    "addTask": "plain string"\n  }\n}\n';
    const selfText = "export const ALLOW = new Set([\n  'tasks:addTask',\n]);";
    const msg = hintMessages({ missing: ['lists:addItem'], badShape: ['tasks:addTask'], stale: ['tasks:addTask'] }, { nlText, selfText }).join('\n');
    expect(msg).toMatch(/apps\/basis\/src\/locales\/chat-hints\.nl\.json:3: tasks:addTask/);
    expect(msg).toMatch(/scripts\/lint-chat-hints-localised\.mjs:2: tasks:addTask/);
    expect(msg.match(/Fix: /g).length).toBe(3);
  });
});

/**
 * Phase 10 — localisation + archive + pause + privacy notice tests.
 *
 * Covers:
 *   1. localisation wrapper — initLocalisation loads en + nl; t() unwraps `{text, doc}`
 *      leaves; missing keys fall back to the key.
 *   2. (the privacy notice lives in pinboard now)
 *   3. circleControls skills — pause/unpause/archive/unarchive (admin /
 *      coord gating) + getPrivacyNotice.
 *   4. addTask gate — paused circle rejects with `error: 'circle-paused'`;
 *      archived circle rejects with `error: 'circle-archived'`; resuming
 *      restores the path.
 *   5. Locale loader — every value matches the project's `{text, doc}`
 *      shape. (Convention check.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DataPart } from '@onderling/core';

import { buildBundle } from '../src/storage/buildBundle.js';
import { createCircleAgent } from '../src/Circle.js';
import { initLocalisation, t, setLang, currentLang, __test__ } from '../src/lib/localisation.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const KID   = 'https://id.example/kid';

const CIRCLE = {
  circleId:  'oss-tools',
  name:    'OSS Tools NL',
  kind:    'project',
  members: [
    { webid: ANNE,  displayName: 'Anne',  role: 'admin' },
    { webid: FRITS, displayName: 'the author', role: 'coordinator' },
    { webid: KID,   displayName: 'Kid',   role: 'member' },
  ],
};

async function callSkill(agent, skillId, args, fromWebid) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Pure localisation + privacy-notice tests ───────────────────────────────────────

describe('Phase 10 — localisation wrapper', () => {
  it('initLocalisation + t() returns the en text', async () => {
    await initLocalisation({ lng: 'en' });
    expect(t('common.save')).toBe('Save');
    expect(t('actions.claim')).toBe('Claim');
    expect(t('status.submitted')).toBe('submitted');
  });

  it('switching to nl returns Dutch copy', async () => {
    await setLang('nl');
    expect(currentLang()).toBe('nl');
    expect(t('common.save')).toBe('Opslaan');
    expect(t('actions.claim')).toBe('Oppakken');
    expect(t('nav.workspace')).toBe('Werkbord');
    await setLang('en');
  });

  it('unknown keys fall back to the key string', async () => {
    await setLang('en');
    expect(t('does.not.exist')).toBe('does.not.exist');
  });

  it('unwrapLeaves transforms {text, doc} pairs', () => {
    const out = __test__.unwrapLeaves({
      a: { text: 'hello', doc: 'greeting' },
      b: { nested: { text: 'world', doc: 'noun' } },
      c: 'plain string',
    });
    expect(out).toEqual({
      a: 'hello',
      b: { nested: 'world' },
      c: 'plain string',
    });
  });

  it('interpolates {{params}} when supplied', async () => {
    await setLang('en');
    expect(t('compose.result_added', { id: '01ABC' })).toBe('Added: 01ABC');
    await setLang('nl');
    expect(t('compose.result_added', { id: '01ABC' })).toBe('Toegevoegd: 01ABC');
    await setLang('en');
  });
});

describe('Phase 10 — locale files conform to {text, doc} convention', () => {
  function flatLeaves(node, path = []) {
    const out = [];
    if (node === null || typeof node !== 'object') {
      out.push({ path: path.join('.'), node });
      return out;
    }
    if (typeof node.text === 'string'
        && (node.doc === undefined || typeof node.doc === 'string')
        && Object.keys(node).every((k) => k === 'text' || k === 'doc')) {
      out.push({ path: path.join('.'), node });
      return out;
    }
    for (const [k, v] of Object.entries(node)) out.push(...flatLeaves(v, [...path, k]));
    return out;
  }

  it('every leaf in en.json is a {text, doc} pair (convention requires both)', async () => {
    const raw = await readFile(join(__dirname, '..', 'locales', 'en.json'), 'utf8');
    const json = JSON.parse(raw);
    const leaves = flatLeaves(json);
    expect(leaves.length).toBeGreaterThan(20); // sanity
    for (const { path: p, node } of leaves) {
      expect(typeof node).toBe('object');
      expect(typeof node.text).toBe('string');
      expect(node.text.length).toBeGreaterThan(0);
      expect(typeof node.doc).toBe('string');
      expect(node.doc.length).toBeGreaterThan(0);
    }
  });

  it('en + nl have the same key set', async () => {
    const en = JSON.parse(await readFile(join(__dirname, '..', 'locales', 'en.json'), 'utf8'));
    const nl = JSON.parse(await readFile(join(__dirname, '..', 'locales', 'nl.json'), 'utf8'));
    const enKeys = flatLeaves(en).map((l) => l.path).sort();
    const nlKeys = flatLeaves(nl).map((l) => l.path).sort();
    expect(nlKeys).toEqual(enKeys);
  });
});


// ── Live skill tests ───────────────────────────────────────────────────────

describe('Phase 10 — circleControls + addTask gate', () => {
  let lsBundle;
  let circle;

  beforeEach(async () => {
    lsBundle = buildBundle();
    circle = await createCircleAgent({
      circleConfig:           CIRCLE,
      localStoreBundle:     lsBundle,
      wireOnboardingSkills: false,
    });
  });

  afterEach(async () => {
    await circle?.close?.();
  });

  it('pauseCircle sets circle.paused; addTask blocked; unpauseCircle restores', async () => {
    const before = await callSkill(circle.agent, 'addTask', { text: 'Pre-pause' }, ANNE);
    expect(before.task?.id).toBeTruthy();

    const p = await callSkill(circle.agent, 'pauseCircle', {}, ANNE);
    expect(p.ok).toBe(true);
    expect(p.paused).toBe(true);

    const blocked = await callSkill(circle.agent, 'addTask', { text: 'During pause' }, ANNE);
    expect(blocked.error).toBe('circle-paused');

    // Existing tasks remain claimable / completable.
    const claim = await callSkill(circle.agent, 'claimTask', { id: before.task.id }, KID);
    expect(claim.result?.assignee).toBe(KID);

    // Unpause restores addTask.
    const u = await callSkill(circle.agent, 'unpauseCircle', {}, ANNE);
    expect(u.paused).toBe(false);
    const after = await callSkill(circle.agent, 'addTask', { text: 'Post-pause' }, ANNE);
    expect(after.task?.id).toBeTruthy();
  });

  it('archiveCircle blocks addTask; unarchive restores', async () => {
    const ar = await callSkill(circle.agent, 'archiveCircle', {}, ANNE);
    expect(ar.archived).toBe(true);
    const blocked = await callSkill(circle.agent, 'addTask', { text: 'Hi' }, ANNE);
    expect(blocked.error).toBe('circle-archived');
    const ua = await callSkill(circle.agent, 'unarchiveCircle', {}, ANNE);
    expect(ua.archived).toBe(false);
    const after = await callSkill(circle.agent, 'addTask', { text: 'Hi again' }, ANNE);
    expect(after.task?.id).toBeTruthy();
  });

  it('archive precedence: archived takes priority over paused in the error code', async () => {
    await callSkill(circle.agent, 'pauseCircle', {}, ANNE);
    await callSkill(circle.agent, 'archiveCircle', {}, ANNE);
    const r = await callSkill(circle.agent, 'addTask', { text: 'Hi' }, ANNE);
    expect(r.error).toBe('circle-archived');
  });

  it('non-admin cannot pause / unpause / archive / unarchive', async () => {
    expect((await callSkill(circle.agent, 'pauseCircle',     {}, KID)).error).toMatch(/admin|coord/i);
    expect((await callSkill(circle.agent, 'archiveCircle',   {}, KID)).error).toMatch(/admin/i);
    expect((await callSkill(circle.agent, 'unarchiveCircle', {}, KID)).error).toMatch(/admin/i);
    // coordinator CAN pause but NOT archive.
    expect((await callSkill(circle.agent, 'pauseCircle',   {}, FRITS)).ok).toBe(true);
    expect((await callSkill(circle.agent, 'archiveCircle', {}, FRITS)).error).toMatch(/admin/i);
  });


  it('getCircleConfig surfaces the paused / archived flags', async () => {
    await callSkill(circle.agent, 'pauseCircle', {}, ANNE);
    const c = await callSkill(circle.agent, 'getCircleConfig');
    expect(c.circle.paused).toBe(true);
    expect(c.circle.archived).toBe(false);
  });
});

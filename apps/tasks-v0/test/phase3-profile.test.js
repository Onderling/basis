/**
 * Phase 3 — canonical user profile + per-circle vocabulary tests.
 *
 * Covers:
 *   1. Canonical profile read/write round-trip + missing-blob fallback (null).
 *   2. Circle vocabulary read/write round-trip.
 *   3. prefilledFormShape — intersection of profile + vocab + taxonomy.
 *   4. Per-circle member-skills projection round-trip.
 *   5. Per-circle posture round-trip.
 *   6. `getMySkillsFormShape` skill (live; via createCircleAgent).
 *   7. `editMySkillsForCircle` skill — writes per-circle projection;
 *      optionally mirrors to canonical profile.
 *   8. Tag normalisation — duplicates dedupe by canonical tag.
 *   9. Off-taxonomy categoryId is dropped (set to null).
 */

import { describe, it, expect } from 'vitest';

import { DataPart } from '@onderling/core';

import { buildBundle } from '../src/storage/buildBundle.js';
import { createCircleAgent } from '../src/Circle.js';
import {
  CANONICAL_PROFILE_PATH,
  readCanonicalProfile,
  writeCanonicalProfile,
  readCircleVocabulary,
  writeCircleVocabulary,
  readMyCircleSkills,
  writeMyCircleSkills,
  readPostureForCircle,
  writePostureForCircle,
  prefilledFormShape,
} from '../src/skills/profile.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';

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

describe('Phase 3 — canonical profile + circle vocabulary', () => {
  describe('canonical profile read/write', () => {
    it('returns null when no profile blob exists', async () => {
      const bundle = buildBundle();
      const got = await readCanonicalProfile({ dataSource: bundle.cache });
      expect(got).toBeNull();
    });

    it('round-trips a write — multilingual dictionary canonicalises tags', async () => {
      const bundle = buildBundle();
      // The shipped tagNormalisation.json maps NL "schilderen" → canonical
      // "painting" (and category "klusjes"). We deliberately rely on this
      // cross-language behaviour so Pinboard / Tasks / Folio all see the same
      // canonical tag regardless of input language.
      await writeCanonicalProfile({
        dataSource: bundle.cache,
        skills: [
          { tag: 'schilderen', categoryId: 'klusjes', level: 'advanced' },
          { tag: 'tuinieren',  categoryId: 'tuin',    level: 'beginner' },
        ],
      });
      const got = await readCanonicalProfile({ dataSource: bundle.cache });
      expect(got.schemaVersion).toBe(1);
      expect(got.skills).toHaveLength(2);
      // "schilderen" → "painting" (canonical EN form via dictionary)
      expect(got.skills[0].tag).toBe('painting');
      expect(got.skills[0].categoryId).toBe('klusjes');
      expect(got.updatedAt).toBeGreaterThan(0);
    });

    it('keeps unknown tags as the lowercase input verbatim', async () => {
      const bundle = buildBundle();
      await writeCanonicalProfile({
        dataSource: bundle.cache,
        skills: [{ tag: 'release-engineer', categoryId: null }],
      });
      const got = await readCanonicalProfile({ dataSource: bundle.cache });
      expect(got.skills[0].tag).toBe('release-engineer');
      expect(got.skills[0].categoryId).toBeNull();
    });

    it('writes to the documented canonical path (mem://user/profile/offerings.json)', async () => {
      expect(CANONICAL_PROFILE_PATH).toBe('mem://user/profile/offerings.json');
      const bundle = buildBundle();
      await writeCanonicalProfile({
        dataSource: bundle.cache,
        skills: [{ tag: 'paint', categoryId: 'klusjes' }],
      });
      const direct = await bundle.cache.read(CANONICAL_PROFILE_PATH);
      expect(direct).toBeTruthy();
      // Blob writes the new `offerings` field + a transitional `skills` alias.
      const blob = typeof direct === 'string' ? JSON.parse(direct) : direct;
      expect(Array.isArray(blob.offerings)).toBe(true);
      expect(Array.isArray(blob.skills)).toBe(true);
    });

    it('read-accepts a legacy skills.json blob when offerings.json is absent', async () => {
      const bundle = buildBundle();
      // Simulate un-migrated data: only the legacy path + legacy `skills` field.
      await bundle.cache.write('mem://user/profile/skills.json', {
        schemaVersion: 1,
        skills: [{ tag: 'paint', categoryId: 'klusjes' }],
        updatedAt: 123,
      });
      const got = await readCanonicalProfile({ dataSource: bundle.cache });
      expect(got.skills).toHaveLength(1);
      expect(got.skills[0].tag).toBe('paint');
      expect(got.updatedAt).toBe(123);
    });

    it('drops off-taxonomy categoryId values to null + dedupes by canonical tag', async () => {
      const bundle = buildBundle();
      await writeCanonicalProfile({
        dataSource: bundle.cache,
        skills: [
          { tag: 'paint', categoryId: 'klusjes' },
          { tag: 'paint', categoryId: 'this-is-not-a-real-category' },     // dup → skipped
          { tag: 'unicorn-grooming', categoryId: 'fictional' },            // unknown → categoryId nulled
        ],
      });
      const got = await readCanonicalProfile({ dataSource: bundle.cache });
      expect(got.skills).toHaveLength(2);
      const unicorn = got.skills.find((s) => s.tag === 'unicorn-grooming');
      expect(unicorn.categoryId).toBeNull();
    });
  });

  describe('circle vocabulary read/write', () => {
    it('round-trips a vocabulary including label + description', async () => {
      const bundle = buildBundle();
      await writeCircleVocabulary({
        dataSource: bundle.cache,
        circleId:     'oss-tools',
        skills: [
          { tag: 'frontend',       categoryId: null, label: 'Frontend dev', description: 'JS/TS, React, etc.' },
          { tag: 'design-review',  categoryId: null, label: 'Design review' },
        ],
      });
      const got = await readCircleVocabulary({ dataSource: bundle.cache, circleId: 'oss-tools' });
      expect(got.skills).toHaveLength(2);
      expect(got.skills[0].label).toBe('Frontend dev');
      expect(got.skills[0].description).toBe('JS/TS, React, etc.');
    });

    it('returns null on missing vocabulary blob', async () => {
      const bundle = buildBundle();
      const got = await readCircleVocabulary({ dataSource: bundle.cache, circleId: 'never-existed' });
      expect(got).toBeNull();
    });
  });

  describe('per-circle member-skills projection', () => {
    it('round-trips per-webid', async () => {
      const bundle = buildBundle();
      await writeMyCircleSkills({
        dataSource: bundle.cache,
        circleId:     'oss-tools',
        webid:      ANNE,
        skills: [{ tag: 'frontend' }, { tag: 'on-call' }],
      });
      const got = await readMyCircleSkills({
        dataSource: bundle.cache,
        circleId:     'oss-tools',
        webid:      ANNE,
      });
      expect(got.webid).toBe(ANNE);
      expect(got.skills).toHaveLength(2);
    });

    it('keeps Anne and Bob projections distinct', async () => {
      const bundle = buildBundle();
      await writeMyCircleSkills({ dataSource: bundle.cache, circleId: 'c', webid: ANNE, skills: [{ tag: 'a' }] });
      await writeMyCircleSkills({ dataSource: bundle.cache, circleId: 'c', webid: BOB,  skills: [{ tag: 'b' }] });
      const a = await readMyCircleSkills({ dataSource: bundle.cache, circleId: 'c', webid: ANNE });
      const b = await readMyCircleSkills({ dataSource: bundle.cache, circleId: 'c', webid: BOB });
      expect(a.skills[0].tag).toBe('a');
      expect(b.skills[0].tag).toBe('b');
    });
  });

  describe('per-circle posture', () => {
    it('round-trips posture per tag, drops invalid values', async () => {
      const bundle = buildBundle();
      await writePostureForCircle({
        dataSource: bundle.cache,
        circleId:     'oss-tools',
        posture:    {
          tags: {
            frontend:        'always',
            'design-review': 'negotiable',
            'on-call':       'never',
            invalid:         'maybe-later',  // dropped
          },
        },
      });
      const got = await readPostureForCircle({ dataSource: bundle.cache, circleId: 'oss-tools' });
      expect(got.tags.frontend).toBe('always');
      expect(got.tags['design-review']).toBe('negotiable');
      expect(got.tags['on-call']).toBe('never');
      expect(got.tags.invalid).toBeUndefined();
    });

    it('returns null when no posture blob exists', async () => {
      const bundle = buildBundle();
      const got = await readPostureForCircle({ dataSource: bundle.cache, circleId: 'fresh-circle' });
      expect(got).toBeNull();
    });
  });

  describe('prefilledFormShape', () => {
    it('partitions skills into prefilled / vocabSuggestions / taxonomyHints', () => {
      const canonicalProfile = {
        schemaVersion: 1,
        skills: [
          { tag: 'schilderen', categoryId: 'klusjes', level: 'advanced' },
          { tag: 'frontend',   categoryId: null }, // not in vocab
        ],
        updatedAt: 1,
      };
      const circleVocabulary = {
        schemaVersion: 1,
        skills: [
          { tag: 'schilderen', categoryId: 'klusjes', label: 'Schilderwerk' },
          { tag: 'tuinieren',  categoryId: 'tuin',    label: 'Tuinwerk'    },  // user doesn't have
        ],
      };

      const shape = prefilledFormShape({ canonicalProfile, circleVocabulary });

      // Prefilled: both of Anne's tags, with `inCircleVocabulary` annotation.
      expect(shape.prefilled).toHaveLength(2);
      const schilderen = shape.prefilled.find((s) => s.tag === 'schilderen');
      expect(schilderen.inCircleVocabulary).toBe(true);
      expect(schilderen.label).toBe('Schilderwerk');
      const frontend = shape.prefilled.find((s) => s.tag === 'frontend');
      expect(frontend.inCircleVocabulary).toBe(false);

      // Vocab suggestions: tags the circle lists that the user doesn't have.
      expect(shape.vocabSuggestions).toHaveLength(1);
      expect(shape.vocabSuggestions[0].tag).toBe('tuinieren');

      // Taxonomy hints: categories not represented by either side.
      expect(shape.taxonomyHints.length).toBeGreaterThan(0);
      // 'klusjes' and 'tuin' are claimed → should NOT appear
      const claimed = ['klusjes', 'tuin'];
      const hintIds = shape.taxonomyHints.map((h) => h.categoryId);
      for (const cat of claimed) expect(hintIds).not.toContain(cat);
    });

    it('handles null inputs without crashing', () => {
      const shape = prefilledFormShape({ canonicalProfile: null, circleVocabulary: null });
      expect(shape.prefilled).toEqual([]);
      expect(shape.vocabSuggestions).toEqual([]);
      // Taxonomy hints come from the shipped TAXONOMY — should be > 0.
      expect(shape.taxonomyHints.length).toBeGreaterThan(0);
    });
  });

  describe('skill registration via createCircleAgent', () => {
    it('registers getMySkillsFormShape + editMySkillsForCircle when localStoreBundle is supplied', async () => {
      const lsBundle = buildBundle();
      const result = await createCircleAgent({
        circleConfig: {
          circleId: 'oss-tools',
          name:   'OSS Tools NL',
          kind:   'project',
          members: [
            { webid: ANNE, displayName: 'Anne', role: 'admin'  },
            { webid: BOB,  displayName: 'Bob',  role: 'member' },
          ],
        },
        localStoreBundle:     lsBundle,
        wireOnboardingSkills: false,  // not needed for this test
      });
      expect(result.agent.skills.has('getMySkillsFormShape')).toBe(true);
      expect(result.agent.skills.has('editMySkillsForCircle')).toBe(true);
    });

    it('still registers profile skills when no localStoreBundle is supplied (V2.8 single-registration)', async () => {
      // every skill registers on the meshAgent regardless of
      // optional substrate wiring. Without a localStoreBundle, the
      // CircleState's `dataSource` is the V0 default MemorySource and
      // the profile skills work against in-memory storage. Tests
      // before expected zero registration in this case.
      const result = await createCircleAgent({
        wireOnboardingSkills: false,
      });
      expect(result.agent.skills.has('getMySkillsFormShape')).toBe(true);
      expect(result.agent.skills.has('editMySkillsForCircle')).toBe(true);
    });

    it('getMySkillsFormShape returns the expected three-list shape', async () => {
      const lsBundle = buildBundle();
      // Seed user profile + circle vocab.
      await writeCanonicalProfile({
        dataSource: lsBundle.cache,
        skills: [{ tag: 'frontend', categoryId: null, level: 'expert' }],
      });
      await writeCircleVocabulary({
        dataSource: lsBundle.cache,
        circleId:     'oss-tools',
        skills: [
          { tag: 'frontend',      categoryId: null, label: 'Frontend' },
          { tag: 'design-review', categoryId: null, label: 'Design review' },
        ],
      });

      const result = await createCircleAgent({
        circleConfig: {
          circleId: 'oss-tools', name: 'OSS Tools', kind: 'project',
          members: [{ webid: ANNE, role: 'admin' }],
        },
        localStoreBundle:     lsBundle,
        wireOnboardingSkills: false,
      });

      const res = await callSkill(result.agent, 'getMySkillsFormShape', { circleId: 'oss-tools' }, ANNE);
      expect(res.canonicalProfile.skills[0].tag).toBe('frontend');
      expect(res.circleVocabulary.skills).toHaveLength(2);
      expect(res.prefilled).toHaveLength(1);
      expect(res.prefilled[0].inCircleVocabulary).toBe(true);
      expect(res.vocabSuggestions).toHaveLength(1);
      expect(res.vocabSuggestions[0].tag).toBe('design-review');
    });

    it('editMySkillsForCircle writes the projection AND optionally the canonical profile', async () => {
      const lsBundle = buildBundle();
      const result = await createCircleAgent({
        circleConfig: {
          circleId: 'oss-tools', name: 'OSS Tools', kind: 'project',
          members: [{ webid: ANNE, role: 'admin' }],
        },
        localStoreBundle:     lsBundle,
        wireOnboardingSkills: false,
      });

      const submitted = [
        { tag: 'frontend',  categoryId: null },
        { tag: 'on-call',   categoryId: null },
      ];

      // First submit WITHOUT mirroring to canonical profile.
      const r1 = await callSkill(result.agent, 'editMySkillsForCircle',
        { circleId: 'oss-tools', skills: submitted },
        ANNE,
      );
      expect(r1.projection.webid).toBe(ANNE);
      expect(r1.projection.skills).toHaveLength(2);
      expect(r1.canonicalProfile).toBeNull();

      // Verify NO canonical-profile blob exists yet.
      const noProfile = await readCanonicalProfile({ dataSource: lsBundle.cache });
      expect(noProfile).toBeNull();

      // Now submit again WITH the opt-in checkbox.
      const r2 = await callSkill(result.agent, 'editMySkillsForCircle',
        { circleId: 'oss-tools', skills: submitted, persistToCanonicalProfile: true },
        ANNE,
      );
      expect(r2.canonicalProfile).toBeTruthy();
      expect(r2.canonicalProfile.skills).toHaveLength(2);

      const profile = await readCanonicalProfile({ dataSource: lsBundle.cache });
      expect(profile.skills).toHaveLength(2);
    });

    it('editMySkillsForCircle rejects calls without a from webid', async () => {
      const lsBundle = buildBundle();
      const result = await createCircleAgent({
        circleConfig: {
          circleId: 'oss-tools', name: 'OSS Tools', kind: 'project',
          members: [{ webid: ANNE, role: 'admin' }],
        },
        localStoreBundle:     lsBundle,
        wireOnboardingSkills: false,
      });
      const r = await callSkill(result.agent, 'editMySkillsForCircle',
        { circleId: 'oss-tools', skills: [] }, undefined);
      expect(r.error).toMatch(/webid required/);
    });
  });
});

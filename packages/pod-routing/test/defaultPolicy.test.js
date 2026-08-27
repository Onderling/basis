/**
 * defaultPolicy — build defaults for pod-having and none users.
 */

import { describe, it, expect } from 'vitest';
import { buildDefaultPolicy } from '../src/defaultPolicy.js';

describe('buildDefaultPolicy — pod-having user', () => {
  it('routes private/sharing to the anchor pod', () => {
    const p = buildDefaultPolicy({
      anchorPodUri: 'https://anne.pod',
      deviceId:     'laptop-anne',
    });
    expect(p.mappings).toMatchObject({
      'private/*':              'https://anne.pod/private/',
      'sharing/*':              'https://anne.pod/sharing/',
      'sharing/profile-public': 'https://anne.pod/sharing/public/profile-card',
      'personal-in-group/*':    'https://anne.pod/personal-in-group/',
    });
    // group routing defaults to pseudo-pod, overridden per-circle by circlePolicies.
    expect(p.mappings['group/*']).toBe('pseudo-pod://laptop-anne/group/');
  });

  it('default circle policy is shared on the anchor pod', () => {
    const p = buildDefaultPolicy({
      anchorPodUri: 'https://anne.pod',
      deviceId:     'laptop-anne',
    });
    expect(p.circlePolicyDefault).toEqual({
      policy:      'shared',
      groupPodUri: 'https://anne.pod',
    });
  });

  it('strips trailing slash from anchor pod URI', () => {
    const p = buildDefaultPolicy({
      anchorPodUri: 'https://anne.pod/',
      deviceId:     'laptop-anne',
    });
    expect(p.mappings['private/*']).toBe('https://anne.pod/private/');
  });
});

describe('buildDefaultPolicy — none user', () => {
  it('routes everything to the device-local pseudo-pod', () => {
    const p = buildDefaultPolicy({
      anchorPodUri: null,
      deviceId:     'laptop-none',
    });
    expect(p.mappings).toMatchObject({
      'private/*':              'pseudo-pod://laptop-none/private/',
      'sharing/*':              'pseudo-pod://laptop-none/sharing/',
      'sharing/profile-public': 'pseudo-pod://laptop-none/sharing/public/profile-card',
      'group/*':                'pseudo-pod://laptop-none/group/',
      'personal-in-group/*':    'pseudo-pod://laptop-none/personal-in-group/',
    });
  });

  it('default circle policy is none', () => {
    const p = buildDefaultPolicy({
      anchorPodUri: null,
      deviceId:     'laptop-none',
    });
    expect(p.circlePolicyDefault).toEqual({ policy: 'none' });
  });

  it('treats undefined anchorPodUri the same as null', () => {
    const p = buildDefaultPolicy({ deviceId: 'd' });
    expect(p.circlePolicyDefault).toEqual({ policy: 'none' });
    expect(p.mappings['private/*']).toBe('pseudo-pod://d/private/');
  });
});

describe('buildDefaultPolicy — input validation', () => {
  it('throws on missing deviceId', () => {
    expect(() => buildDefaultPolicy({ anchorPodUri: 'x' })).toThrow(/deviceId/);
    expect(() => buildDefaultPolicy({ deviceId: '' })).toThrow(/deviceId/);
  });
});

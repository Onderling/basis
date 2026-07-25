/**
 * mij#personas — MOBILE profile-picture host wiring (mijHost.js: setProfilePicture,
 * loadCurrentPicture, resolveSealedThumbUri).
 *
 * The seal/upload pipeline (createMediaEmbed) and the sealed-thumb custody
 * (openThumbnail) are proven elsewhere; here we lock the mobile SET op sequence
 * (createMediaEmbed → setProfileProperty on the GENERAL persona, web parity) + the
 * RN preview idiom (sealed thumb → data: URI). createMediaEmbed + openThumbnail are
 * mocked so this stays a pure wiring test (vitest excludes the RN screen).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../basis/src/core/handlers/mediaEmbed.js', () => ({
  createMediaEmbed: vi.fn(),
}));
vi.mock('@onderling/blob-gateway', () => ({
  openThumbnail: vi.fn(),
}));

import { createMediaEmbed } from '../../basis/src/core/handlers/mediaEmbed.js';
import { openThumbnail } from '@onderling/blob-gateway';
import { setProfilePicture, loadCurrentPicture, resolveSealedThumbUri } from '../src/core/mijHost.js';

const GATEWAY = { bucket: {}, sealer: () => 'sealed', keyRef: 'k' };
const SOURCE_LINE = { type: 'blob', ref: 'blob://self/pic', enc: { sealed: true, mime: 'image/jpeg' } };

beforeEach(() => { vi.clearAllMocks(); });

describe('setProfilePicture — the mobile SET sequence (web parity)', () => {
  it('seals the picked image then records it as the GENERAL persona profilePicture', async () => {
    createMediaEmbed.mockResolvedValue({ snapshot: { source: SOURCE_LINE } });
    const callSkill = vi.fn(async () => ({ ok: true }));
    const openFilePicker = vi.fn();

    const r = await setProfilePicture({
      callSkill, defaultId: 'default', mediaGateway: GATEWAY, openFilePicker, localActor: 'me', t: (k) => k,
    });

    expect(r).toEqual({ ok: true, source: SOURCE_LINE });
    // sealed through the injected (self) gateway + picker
    expect(createMediaEmbed).toHaveBeenCalledWith({}, expect.objectContaining({ mediaGateway: GATEWAY, openFilePicker }));
    // recorded on the DEFAULT (general/truth) persona — never a circle
    expect(callSkill).toHaveBeenCalledWith('agents', 'setProfileProperty', { id: 'default', key: 'profilePicture', value: SOURCE_LINE });
  });

  it('a cancelled pick (embed ok:false) records nothing', async () => {
    createMediaEmbed.mockResolvedValue({ ok: false, error: 'media.pick_cancelled' });
    const callSkill = vi.fn(async () => ({ ok: true }));
    const r = await setProfilePicture({ callSkill, mediaGateway: GATEWAY, openFilePicker: vi.fn(), t: (k) => k });
    expect(r).toEqual({ ok: false });
    expect(callSkill).not.toHaveBeenCalled();
  });

  it('a sealed-only / missing gateway is refused up front (no embed attempt)', async () => {
    const callSkill = vi.fn();
    const r = await setProfilePicture({ callSkill, mediaGateway: null, openFilePicker: vi.fn(), t: (k) => k });
    expect(r).toEqual({ ok: false });
    expect(createMediaEmbed).not.toHaveBeenCalled();
    expect(callSkill).not.toHaveBeenCalled();
  });

  it('a setProfileProperty failure surfaces {ok:false} (the screen re-reads either way)', async () => {
    createMediaEmbed.mockResolvedValue({ snapshot: { source: SOURCE_LINE } });
    const callSkill = vi.fn(async () => { throw new Error('offline'); });
    const r = await setProfilePicture({ callSkill, mediaGateway: GATEWAY, openFilePicker: vi.fn(), t: (k) => k });
    expect(r).toEqual({ ok: false });
  });
});

describe('loadCurrentPicture — reads the general persona ref', () => {
  it('returns the profilePicture value (object-entry or bare)', async () => {
    const callSkill = vi.fn(async () => ({ properties: { profilePicture: { value: SOURCE_LINE } } }));
    expect(await loadCurrentPicture({ callSkill, defaultId: 'default' })).toBe(SOURCE_LINE);
    expect(callSkill).toHaveBeenCalledWith('agents', 'getProfileProperties', { id: 'default' });
  });
  it('null when unset or on failure', async () => {
    expect(await loadCurrentPicture({ callSkill: vi.fn(async () => ({ properties: {} })) })).toBeNull();
    expect(await loadCurrentPicture({ callSkill: vi.fn(async () => { throw new Error('x'); }) })).toBeNull();
  });
});

describe('resolveSealedThumbUri — RN preview idiom', () => {
  it('opens the sealed thumb and returns a data: URI with the ref mime', () => {
    openThumbnail.mockReturnValue(new Uint8Array([1, 2, 3]));
    const uri = resolveSealedThumbUri(SOURCE_LINE, () => 'plain');
    expect(uri).toMatch(/^data:image\/jpeg;base64,/);
    expect(openThumbnail).toHaveBeenCalledWith({ ref: SOURCE_LINE, opener: expect.any(Function) });
  });
  it('null on a wrong key (opener throws) / empty thumb / no opener', () => {
    openThumbnail.mockImplementation(() => { throw new Error('wrong key'); });
    expect(resolveSealedThumbUri(SOURCE_LINE, () => 'x')).toBeNull();
    openThumbnail.mockReturnValue(new Uint8Array([]));
    expect(resolveSealedThumbUri(SOURCE_LINE, () => 'x')).toBeNull();
    expect(resolveSealedThumbUri(SOURCE_LINE, null)).toBeNull();
  });
});

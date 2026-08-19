/**
 * Wizard state-machines — split. Covers the second wave:
 * conflictDispute, settings, joinGroup, createGroup.
 *
 * Same shape as wizardsState.test.js — pure functions +
 * async submits with stub callSkills; zero DOM.
 */
import { describe, it, expect, vi } from 'vitest';

// ── conflictDispute ─────────────────────────────────────────────
import * as CD from '../../../src/core/wizards/conflictDisputeState.js';

describe('conflictDisputeState', () => {
  it('initialState pre-seeds from postId or id arg', () => {
    expect(CD.initialState({ postId: 'p1' }).aboutPostId).toBe('p1');
    expect(CD.initialState({ id: 'p2' }).aboutPostId).toBe('p2');
    expect(CD.initialState().aboutPostId).toBe('');
  });

  it('isSummaryValid requires 10+ trimmed chars', () => {
    expect(CD.isSummaryValid('short')).toBe(false);
    expect(CD.isSummaryValid('   ' + 'a'.repeat(10) + '   ')).toBe(true);
    expect(CD.isSummaryValid(null)).toBe(false);
  });

  it('isProposalValid requires 5+ trimmed chars', () => {
    expect(CD.isProposalValid('abc')).toBe(false);
    expect(CD.isProposalValid('abcde')).toBe(true);
  });

  it('labelOf returns the option label, falls back to id', () => {
    expect(CD.labelOf(CD.ESCALATION_PATHS, 'mediation')).toMatch(/Mediation/);
    expect(CD.labelOf(CD.ESCALATION_PATHS, 'unknown-id')).toBe('unknown-id');
  });

  it('loadAboutPostText: skips when no aboutPostId', async () => {
    const state = CD.initialState();
    const callSkill = vi.fn();
    await CD.loadAboutPostText({ state, callSkill });
    expect(callSkill).not.toHaveBeenCalled();
  });

  it('loadAboutPostText finds the post by id', async () => {
    const state = CD.initialState({ postId: 'p1' });
    const callSkill = vi.fn().mockResolvedValue({
      items: [{ id: 'other' }, { id: 'p1', text: 'the post text' }],
    });
    await CD.loadAboutPostText({ state, callSkill });
    expect(state.aboutPostText).toBe('the post text');
  });

  it('loadAboutPostText silently swallows substrate errors', async () => {
    const state = CD.initialState({ postId: 'p1' });
    const callSkill = vi.fn().mockRejectedValue(new Error('boom'));
    await CD.loadAboutPostText({ state, callSkill });
    expect(state.aboutPostText).toBe(null);   // unchanged
  });

  it('formatDisputeText assembles a structured body', () => {
    const state = CD.initialState({ postId: 'p1' });
    state.summary = 'X happened.';
    state.proposal = 'Y.';
    state.escalation = 'mediation';
    const t = CD.formatDisputeText(state);
    expect(t).toMatch(/\[Dispute\] X happened/);
    expect(t).toMatch(/Proposed: Y/);
    expect(t).toMatch(/escalation: mediation/);
    expect(t).toMatch(/About: p1/);
  });

  it('formatDisputeText omits About when no postId', () => {
    const state = CD.initialState();
    state.summary = 'X.';
    state.proposal = 'Y.';
    state.escalation = 'vote';
    expect(CD.formatDisputeText(state)).not.toMatch(/About:/);
  });

  it('submitDispute happy-path: posts via stoop.postRequest', async () => {
    const state = CD.initialState();
    state.summary = 'something happened';
    state.proposal = 'an apology';
    const callSkill = vi.fn().mockResolvedValue({ ok: true, postId: 'dispute-1' });
    const { result } = await CD.submitDispute({ state, callSkill });
    expect(callSkill.mock.calls[0][0]).toBe('stoop');
    expect(callSkill.mock.calls[0][1]).toBe('postRequest');
    expect(callSkill.mock.calls[0][2].kind).toBe('dispute');
    expect(state.successResult).toBe(result);
  });

  it('submitDispute failure: sets submitError', async () => {
    const state = CD.initialState();
    state.summary = 'x'; state.proposal = 'y';
    const callSkill = vi.fn().mockRejectedValue(new Error('substrate down'));
    const r = await CD.submitDispute({ state, callSkill });
    expect(r.result).toBeUndefined();
    expect(state.submitError).toBe('substrate down');
  });
});

// ── settings ────────────────────────────────────────────────────
import * as ST from '../../../src/core/wizards/settingsState.js';

describe('settingsState', () => {
  it('initialState marks panel as loading', () => {
    const s = ST.initialState();
    expect(s.loading).toBe(true);
    expect(s.profile).toBe(null);
    expect(s.holiday).toBe(null);
  });

  it('LANG_OPTIONS includes en + nl', () => {
    const codes = ST.LANG_OPTIONS.map((o) => o.code);
    expect(codes).toContain('en');
    expect(codes).toContain('nl');
  });

  it('TRANSPORT_MODES is the canonical 3-entry list', () => {
    expect(ST.TRANSPORT_MODES).toEqual(['nkn', 'relay', 'both']);
  });

  it('loadSettings populates profile + holiday + clears loading', async () => {
    const state = ST.initialState();
    const callSkill = vi.fn()
      .mockResolvedValueOnce({ handle: 'h', displayName: 'D' })   // getStoopProfile
      .mockResolvedValueOnce({ holidayMode: true });               // getHolidayMode
    await ST.loadSettings({ state, callSkill });
    expect(state.profile).toEqual({ handle: 'h', displayName: 'D' });
    expect(state.holiday).toBe(true);
    expect(state.loading).toBe(false);
  });

  it('loadSettings swallows per-skill failures (one bad call doesn\'t block the other)', async () => {
    const state = ST.initialState();
    const callSkill = vi.fn()
      .mockRejectedValueOnce(new Error('no profile'))
      .mockResolvedValueOnce({ holidayMode: false });
    await ST.loadSettings({ state, callSkill });
    expect(state.profile).toBe(null);
    expect(state.holiday).toBe(false);
    expect(state.loading).toBe(false);
  });

  it('saveHandle rejects empty input', async () => {
    const callSkill = vi.fn();
    expect(await ST.saveHandle({ callSkill, handle: '   ' })).toEqual({ ok: false, error: 'empty' });
    expect(callSkill).not.toHaveBeenCalled();
  });

  it('saveHandle trims + delegates to setMyHandle', async () => {
    const callSkill = vi.fn().mockResolvedValue({});
    const r = await ST.saveHandle({ callSkill, handle: '  anne  ' });
    expect(r.ok).toBe(true);
    expect(callSkill).toHaveBeenCalledWith('stoop', 'setMyHandle', { handle: 'anne' });
  });

  it('saveDisplayName parallels saveHandle', async () => {
    const callSkill = vi.fn().mockResolvedValue({});
    const r = await ST.saveDisplayName({ callSkill, displayName: 'Anne K' });
    expect(r.ok).toBe(true);
    expect(callSkill).toHaveBeenCalledWith('stoop', 'setMyDisplayName', { displayName: 'Anne K' });
  });

  it('setHolidayMode returns the substrate-reported flag', async () => {
    const callSkill = vi.fn().mockResolvedValue({ holidayMode: true });
    const r = await ST.setHolidayMode({ callSkill, on: true });
    expect(r).toEqual({ ok: true, holidayMode: true });
  });

  it('setHolidayMode surfaces error on failure', async () => {
    const callSkill = vi.fn().mockRejectedValue(new Error('boom'));
    const r = await ST.setHolidayMode({ callSkill, on: true });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('boom');
  });
});

// ── joinGroup ───────────────────────────────────────────────────
import * as JG from '../../../src/core/wizards/joinGroupState.js';

describe('joinGroupState', () => {
  it('privacyNoticeFor picks the right language; falls back to en', () => {
    expect(JG.privacyNoticeFor('nl')).toMatch(/buurt|leden/i);
    expect(JG.privacyNoticeFor('en')).toMatch(/circle|posts/i);
    expect(JG.privacyNoticeFor('xx')).toBe(JG.PRIVACY_NOTICE.en);
  });

  it('handleSuggestions slugifies the base name + adds 2 variants, all of them VALID', () => {
    // This test used to pin the old output exactly — and the old output was wrong in a way the test
    // recorded without noticing: `'anne-k-'` ends in a dash, and `isValidHandle` (asserted three lines
    // below) rejects that. The other two carried a random two-digit suffix, so they changed on every
    // render. Seen on a device as an empty pill, `-29` and `.2026` (S3, 2026-07-30).
    const suggestions = JG.handleSuggestions('Anne K.');
    expect(suggestions).toEqual(['anne-k', 'anne-k-2026', 'anne-k2']);
    // The property that matters more than the exact strings:
    for (const s of suggestions) expect(JG.isValidHandle(s), s).toBe(true);
  });

  it('isValidHandle accepts lower+digits+ _ -; rejects mixed case', () => {
    expect(JG.isValidHandle('anne')).toBe(true);
    expect(JG.isValidHandle('anne-k_99')).toBe(true);
    expect(JG.isValidHandle('Anne')).toBe(false);
    // 'a' is valid per the regex (^[a-z0-9](?:...)?$ — optional middle).
    expect(JG.isValidHandle('a')).toBe(true);
    expect(JG.isValidHandle('a'.repeat(31))).toBe(false);  // too long (max 30)
    expect(JG.isValidHandle('with space')).toBe(false);
  });

  it('decodeInvite: no invite → parse error', () => {
    const state = JG.initialState();
    JG.decodeInvite(null, state);
    expect(state.inviteParseError).toMatch(/No invite/);
  });

  it('decodeInvite: pre-decoded object passes through', () => {
    const state = JG.initialState();
    JG.decodeInvite({ groupId: 'b1', kind: 'membershipCode' }, state);
    expect(state.invite).toEqual({ groupId: 'b1', kind: 'membershipCode' });
  });

  it('decodeInvite: JSON-literal URL parses', () => {
    const state = JG.initialState();
    JG.decodeInvite('onderling-invite://{"groupId":"b2","code":"c"}', state);
    expect(state.invite).toEqual({ groupId: 'b2', code: 'c' });
  });

  it('decodeInvite: base64 form parses', () => {
    const state = JG.initialState();
    const json = JSON.stringify({ groupId: 'b3', code: 'x' });
    const b64 = Buffer.from(json).toString('base64').replace(/=/g, '');
    JG.decodeInvite(`onderling-invite://${b64}`, state);
    expect(state.invite.groupId).toBe('b3');
  });

  it('summariseEmbeddedRules falls back to a default when nothing populated', () => {
    expect(JG.summariseEmbeddedRules({})).toMatch(/no rules/);
    expect(JG.summariseEmbeddedRules({ rulesText: 'custom' })).toBe('custom');
    expect(JG.summariseEmbeddedRules({ purpose: 'P', leavePolicy: 'anyone' }))
      .toMatch(/Purpose: P/);
  });

  it('fetchGroupRules uses embedded rules when present (no substrate call)', async () => {
    const state = JG.initialState();
    state.invite = { rules: { purpose: 'Test' } };
    const callSkill = vi.fn();
    await JG.fetchGroupRules({ state, callSkill });
    expect(state.rulesText).toMatch(/Purpose: Test/);
    expect(callSkill).not.toHaveBeenCalled();
  });

  // 5.5b — structured doc surfacing for the consent screen.
  it('extractRulesDoc returns null when nothing structured is set', () => {
    expect(JG.extractRulesDoc(null)).toBeNull();
    expect(JG.extractRulesDoc({})).toBeNull();
    expect(JG.extractRulesDoc({ rulesText: 'plain' })).toBeNull();  // old-format invite
    expect(JG.extractRulesDoc({ purpose: '' })).toBeNull();         // empty doesn't count
  });

  it('extractRulesDoc populates every doc field (empty → "")', () => {
    const out = JG.extractRulesDoc({ purpose: 'P', agreements: 'A' });
    expect(out.purpose).toBe('P');
    expect(out.agreements).toBe('A');
    expect(out.admins).toBe('');     // structured field present, just blank
    expect(out.responsibility).toBe('');
  });

  it('fetchGroupRules with a v2 invite populates state.rulesDoc + state.rulesText', async () => {
    const state = JG.initialState();
    state.invite = { rules: { purpose: 'Test', agreements: 'Be kind.' } };
    await JG.fetchGroupRules({ state, callSkill: vi.fn() });
    expect(state.rulesDoc).toEqual(expect.objectContaining({
      purpose: 'Test', agreements: 'Be kind.',
    }));
    // text summary still set as a fallback for old renderers.
    expect(state.rulesText).toMatch(/Purpose: Test/);
  });

  it('fetchGroupRules with a v1-style invite (rulesText only) leaves rulesDoc null', async () => {
    const state = JG.initialState();
    state.invite = { rules: { rulesText: 'plain' } };
    await JG.fetchGroupRules({ state, callSkill: vi.fn() });
    expect(state.rulesDoc).toBeNull();
    expect(state.rulesText).toBe('plain');
  });

  it('fetchGroupRules falls back to getGroupRules substrate call', async () => {
    const state = JG.initialState();
    state.invite = { groupId: 'b1' };  // no embedded rules
    const callSkill = vi.fn().mockResolvedValue({ rules: 'remote rules text' });
    await JG.fetchGroupRules({ state, callSkill });
    expect(callSkill).toHaveBeenCalledWith('stoop', 'getGroupRules', { groupId: 'b1' });
    expect(state.rulesText).toBe('remote rules text');
  });

  it('finalSubmit membershipCode path: handle + redeem', async () => {
    const state = JG.initialState();
    state.invite = { kind: 'membershipCode', groupId: 'b1', code: 'c1' };
    state.handle = 'anne';
    const callSkill = vi.fn()
      .mockResolvedValueOnce({ ok: true })                       // setMyHandle
      .mockResolvedValueOnce({ ok: true });                      // redeemMembershipCode
    const { result } = await JG.finalSubmit({ state, callSkill });
    expect(result.ok).toBe(true);
    expect(result.groupId).toBe('b1');
    expect(result.handle).toBe('anne');
  });

  it('finalSubmit membershipCode: expired-code triggers peer fallback', async () => {
    const state = JG.initialState();
    state.invite = { kind: 'membershipCode', groupId: 'b1', code: 'c1', adminPeerAddr: 'NKN-ADMIN', rules: { purpose: 'P' } };
    state.handle = 'anne';
    const callSkill = vi.fn()
      .mockResolvedValueOnce({ ok: true })                                  // setMyHandle
      .mockResolvedValueOnce({ error: 'invalid-or-expired-code' })          // redeemMembershipCode
      .mockResolvedValueOnce({ ok: true });                                 // recordRemoteRedemption
    const sendPeerRedeem = vi.fn().mockResolvedValue({ codeId: 'c-1', validUntil: 'soon' });
    const { result } = await JG.finalSubmit({ state, callSkill, sendPeerRedeem });
    expect(sendPeerRedeem).toHaveBeenCalled();
    expect(result.message).toMatch(/peer-bridge/);
    // recordRemoteRedemption should have been called with the rules.
    expect(callSkill.mock.calls[2][2].rules).toEqual({ purpose: 'P' });
  });

  // This test used to assert the legacy-invite chain (gate → handle → redeemInvite) and passed by
  // MOCKING redeemInvite to return {ok:true} — an op that does not exist in this app, so the mock was
  // the only thing keeping a dead path looking alive. The real dispatch throws `Unknown skill`.
  // What is asserted now is the honest behaviour: anything that is not a membership code is refused
  // BY NAME, and no skill is dispatched at all.
  it('finalSubmit refuses a non-membership-code invite by name, dispatching nothing', async () => {
    const state = JG.initialState();
    state.invite = { groupId: 'b2' };   // no kind field
    state.handle = 'anne';
    state.rulesAccepted = true;
    state.privacyAccepted = true;
    const callSkill = vi.fn();
    const { result } = await JG.finalSubmit({ state, callSkill });
    expect(result, 'a refused join must not report a result').toBeUndefined();
    expect(state.submitError, 'the refusal must name what was wrong').toMatch(/not a membership code/i);
    expect(callSkill, 'a refused join must not dispatch anything').not.toHaveBeenCalled();
  });

  it('finalSubmit aborts on first error + sets submitError', async () => {
    const state = JG.initialState();
    state.invite = { kind: 'membershipCode', groupId: 'b1', code: 'c1' };
    state.handle = 'a';
    const callSkill = vi.fn().mockResolvedValue({ error: 'bad handle' });
    const r = await JG.finalSubmit({ state, callSkill });
    expect(r.result).toBeUndefined();
    expect(state.submitError).toBe('bad handle');
  });

  /* ── B · — consent-at-join ─────────────────────────── */

  const consentSources = [{
    manifest: {
      app: 'tasks', itemTypes: ['task'],
      nouns: { task: { atoms: ['add', 'complete'] } },
      operations: [
        { id: 'addTask', verb: 'add', appliesTo: { type: 'task' } },
        { id: 'doneTask', verb: 'complete', appliesTo: { type: 'task' } },
      ],
    },
  }];
  // admin: 'add task' required (mandatory), 'complete task' optional (opt-outable)
  const consentInvite = {
    kind: 'membershipCode', groupId: 'b1', code: 'c1',
    apps: ['tasks'],
    capabilities: { 'tasks add task': { freedom: 'required' }, 'tasks complete task': { freedom: 'optional' } },
  };

  it('buildJoinConsent surfaces only the opt-outable caps from the embedded template', () => {
    const state = JG.initialState();
    state.invite = consentInvite;
    JG.buildJoinConsent({ state, sources: consentSources });
    expect(state.consentModel.keys).toEqual(['tasks complete task']);   // the required cap is not offered
    expect(state.capabilityOptOuts).toEqual([]);
  });

  it('buildJoinConsent with no embedded template ⇒ empty model (no-op step)', () => {
    const state = JG.initialState();
    state.invite = { kind: 'membershipCode', groupId: 'b1', code: 'c1' };
    JG.buildJoinConsent({ state, sources: consentSources });
    expect(state.consentModel.items).toEqual([]);
  });

  it('setConsentDecline records an opt-outable cap and refuses a mandatory one', () => {
    const state = JG.initialState();
    state.invite = consentInvite;
    JG.buildJoinConsent({ state, sources: consentSources });
    JG.setConsentDecline(state, 'tasks complete task', true);
    expect(state.capabilityOptOuts).toEqual(['tasks complete task']);
    // a mandatory cap can never be declined — dropped by the model validation
    JG.setConsentDecline(state, 'tasks add task', true);
    expect(state.capabilityOptOuts).toEqual(['tasks complete task']);
    // opting back in removes it
    JG.setConsentDecline(state, 'tasks complete task', false);
    expect(state.capabilityOptOuts).toEqual([]);
  });

  it('finalSubmit carries capabilityOptOuts out in the success envelope', async () => {
    const state = JG.initialState();
    state.invite = consentInvite;
    state.handle = 'anne';
    JG.buildJoinConsent({ state, sources: consentSources });
    JG.setConsentDecline(state, 'tasks complete task', true);
    const callSkill = vi.fn()
      .mockResolvedValueOnce({ ok: true })   // setMyHandle
      .mockResolvedValueOnce({ ok: true });  // redeemMembershipCode
    const { result } = await JG.finalSubmit({ state, callSkill });
    expect(result.capabilityOptOuts).toEqual(['tasks complete task']);
  });

  it('finalSubmit with no opt-outs leaves capabilityOptOuts off the envelope (unchanged behaviour)', async () => {
    const state = JG.initialState();
    state.invite = consentInvite;
    state.handle = 'anne';
    JG.buildJoinConsent({ state, sources: consentSources });
    const callSkill = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });
    const { result } = await JG.finalSubmit({ state, callSkill });
    expect(result.capabilityOptOuts).toBeUndefined();
  });
});

// ── createGroup ─────────────────────────────────────────────────
import * as CG from '../../../src/core/wizards/createGroupState.js';

describe('createGroupState', () => {
  it('initialState carries policy defaults', () => {
    const s = CG.initialState();
    expect(s.step).toBe(1);
    expect(s.accessPolicy).toBe('invite-only');
    expect(s.conflictPolicy).toBe('mediation');
    expect(s.storagePolicy).toBe('no-pod');
    expect(s.keyRotationMode).toBe('admin-only');
  });

  it('STEP_NAMES is the canonical 6-step list (5.5c — Offerings slotted between Rules and Tech)', () => {
    expect(CG.STEP_NAMES).toEqual(['Identity', 'Governance', 'Rules', 'Offerings', 'Tech', 'Review']);
  });

  // 5.5c — offerings wiring into the rules blob.
  it('buildRulesObjectFromState: empty offerings array → no offerings key', () => {
    const s = CG.initialState();
    const r = CG.buildRulesObjectFromState(s);
    expect(r.offerings).toBeUndefined();
    expect(r.skills).toBeUndefined();
  });

  it('buildRulesObjectFromState: drops unnamed offering rows + normalises kept ones', () => {
    const s = CG.initialState();
    s.offerings = [
      { name: '',        openness: 'circle'   },     // dropped (no name)
      { name: 'gardening', openness: 'public', posture: 'negotiable', status: 'active', radius: 'street' },
      { name: 'plumbing',  openness: 'bogus'  },     // bogus axis falls back to default
    ];
    const r = CG.buildRulesObjectFromState(s);
    expect(r.offerings).toHaveLength(2);
    // Transitional `rules.skills` alias mirrors offerings (wire read-accept).
    expect(r.skills).toHaveLength(2);
    expect(r.offerings[0]).toEqual({
      name: 'gardening', openness: 'public', posture: 'negotiable', status: 'active', radius: 'street',
    });
    expect(r.offerings[1].name).toBe('plumbing');
    expect(r.offerings[1].openness).toBe('private');   // normalised default
  });

  it('buildRulesObjectFromState: read-accepts a legacy in-memory state.skills', () => {
    const s = CG.initialState();
    delete s.offerings;                       // un-migrated state: no offerings field
    s.skills = [{ name: 'gardening', openness: 'public' }];
    const r = CG.buildRulesObjectFromState(s);
    expect(r.offerings).toHaveLength(1);
    expect(r.offerings[0].name).toBe('gardening');
  });

  it('newOfferingRow seeds a row with the offering default axes', () => {
    const row = CG.newOfferingRow();
    expect(row.name).toBe('');
    expect(CG.OFFERING_AXES.openness).toContain(row.openness);
  });

  it('slugify normalises arbitrary names', () => {
    expect(CG.slugify('Mijn Circle')).toBe('mijn-circle');
    expect(CG.slugify('  --!!--  ')).toBe('');
    expect(CG.slugify('Café 123 ✓')).toBe('caf-123');
    expect(CG.slugify('a'.repeat(50))).toHaveLength(30);
  });

  it('isValidSlug: same rules as joinGroup.isValidHandle', () => {
    expect(CG.isValidSlug('circle-1')).toBe(true);
    expect(CG.isValidSlug('UPPER')).toBe(false);
    expect(CG.isValidSlug('')).toBe(false);   // empty fails
    expect(CG.isValidSlug('a'.repeat(31))).toBe(false);
  });

  it('labelOf: same fallback as conflictDispute.labelOf', () => {
    expect(CG.labelOf(CG.ACCESS_POLICIES, 'open')).toMatch(/Open/);
    expect(CG.labelOf(CG.ACCESS_POLICIES, 'unknown')).toBe('unknown');
  });

  it('buildRulesObjectFromState: empty slots collapse', () => {
    const s = CG.initialState();
    const r = CG.buildRulesObjectFromState(s);
    expect(r.purpose).toBeUndefined();
    expect(r.tags).toBeUndefined();
    expect(r.additionalAdmins).toBeUndefined();
    expect(r.agreements).toBeUndefined();          // 5.5a — no doc field set
    expect(r.accessPolicy).toBe('invite-only');
    expect(r.leavePolicy).toBe('anyone');
    expect(r.conflictPolicy).toBe('mediation');
  });

  it('buildRulesObjectFromState parses CSV lists + spreads the rules doc', () => {
    const s = CG.initialState();
    s.tags = 'tools, gardening,, ';
    s.additionalAdmins = 'webid:a, webid:b';
    s.purpose = 'Test circle';
    s.rulesDoc.agreements = 'Be kind.';
    s.rulesDoc.conflict   = 'Mediation by two.';
    s.rulesDoc.admission  = 'Admins must approve.';
    const r = CG.buildRulesObjectFromState(s);
    expect(r.tags).toEqual(['tools', 'gardening']);
    expect(r.additionalAdmins).toEqual(['webid:a', 'webid:b']);
    expect(r.purpose).toBe('Test circle');           // Step 1 → rules doc
    expect(r.agreements).toBe('Be kind.');           // 5.5a — structured doc
    expect(r.conflict).toBe('Mediation by two.');
    expect(r.admission).toBe('Admins must approve.');
    // The machine-readable conflict ENUM coexists with the doc's free text.
    expect(r.conflictPolicy).toBe('mediation');
  });

  it('finalSubmit happy-path: calls createGroupV2 with composed rules', async () => {
    const state = CG.initialState();
    state.groupId = 'b1';
    state.name    = 'Circle 1';
    state.purpose = 'Test';
    const callSkill = vi.fn().mockResolvedValue({ ok: true, groupId: 'b1', code: 'JOIN-CODE' });
    const { result } = await CG.finalSubmit({ state, callSkill });
    expect(result.code).toBe('JOIN-CODE');
    const args = callSkill.mock.calls[0][2];
    expect(args.groupId).toBe('b1');
    expect(args.name).toBe('Circle 1');
    expect(args.rules.purpose).toBe('Test');
    expect(args.storagePolicy).toBe('no-pod');
    expect(args.groupPodUri).toBeUndefined();
  });

  it('finalSubmit includes groupPodUri only when set', async () => {
    const state = CG.initialState();
    state.groupId = 'b1';
    state.storagePolicy = 'centralised';
    state.groupPodUri = 'https://pods.example/circle-1/';
    const callSkill = vi.fn().mockResolvedValue({ ok: true });
    await CG.finalSubmit({ state, callSkill });
    expect(callSkill.mock.calls[0][2].groupPodUri).toBe('https://pods.example/circle-1/');
  });

  it('finalSubmit failure: surfaces error', async () => {
    const state = CG.initialState();
    state.groupId = 'b1';
    const callSkill = vi.fn().mockResolvedValue({ error: 'slug taken' });
    const r = await CG.finalSubmit({ state, callSkill });
    expect(r.result).toBeUndefined();
    expect(state.submitError).toBe('slug taken');
  });
});
